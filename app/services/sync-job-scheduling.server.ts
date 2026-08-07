import {
  AuditEventType,
  EbayConnection,
  EbayConnectionStatus,
  Prisma,
  ProductMappingStatus,
  ShopInstallationStatus,
  SyncConflictStatus,
  SyncJobStatus,
  SyncJobType,
} from "@prisma/client";
import prisma from "../db.server";
import { chunkArray } from "../lib/chunk-array";
import { mapWithConcurrency } from "../lib/map-with-concurrency";
import { SYNCBAY_AUDIT_LOG_CREATE_SELECT } from "../lib/syncbay-audit-log-write";
import {
  getCatalogImageRepairCandidateWhere,
  getCatalogImageRepairItemIds,
  getCatalogImageRepairRunKey,
} from "../lib/syncbay-catalog-image-repair";
import {
  buildCatalogReconcilePlan,
  isCatalogReconcileScanComplete,
} from "../lib/syncbay-catalog-reconcile";
import {
  getSellerEventsDeltaWindow,
  getSellerEventsWatermarkAt,
  isFullCatalogReconcileDue,
} from "../lib/syncbay-ebay-delta-sync";
import {
  getNextEbayTradingRateLimitRetryAt,
  isEbayTradingUsageLimitError,
} from "../lib/syncbay-ebay-rate-limit";
import { serializeIncrementalPreviewCandidate } from "../lib/syncbay-incremental-preview-candidate";
import {
  getNextIncrementalEnqueueAt,
  shouldEnqueueIncrementalSyncNow,
} from "../lib/syncbay-incremental-schedule";
import {
  CATALOG_RECONCILE_JOB_SOURCE,
  FACET_BACKFILL_INCREMENTAL_JOB_SOURCE,
  buildSellerEventsNoopMarker,
  getCatalogReconcileJobIdsToCancelBeforeNewRun,
  getSupersededCatalogReconcileJobIds,
  isSchedulableSyncJob,
} from "../lib/syncbay-job-scheduling";
import {
  RUNNER_LANES,
  shouldPrioritizeNonReconcileIncrementalJob,
  type RunnerLane,
} from "../lib/syncbay-runner-fairness";
import {
  STALE_FAILED_INCREMENTAL_SYNC_ARCHIVE_AFTER_MS,
  STALE_FAILED_INCREMENTAL_SYNC_ERROR_CODES,
} from "../lib/syncbay-stale-failed-job-archive";
import { getRecoverableRunningSyncJobTypes } from "../lib/syncbay-stale-job-recovery";
import { DEFAULT_EBAY_MARKETPLACE_ID as DEFAULT_MARKETPLACE_ID } from "./ebay-environment.server";
import { getUsableEbayAccessToken } from "./ebay-token.server";
import {
  getEbayTradingCatalogImportPlan,
  getEbayTradingSellerEventsDelta,
} from "./ebay-trading-preview.server";
import { type ImportPreviewListingCandidate } from "./import-preview.server";

import {
  DueSyncJob,
  RUNNER_EBAY_ITEM_BATCH_SIZE,
  dueSyncJobSelect,
  getErrorMessage,
  getJsonNumber,
  getJsonObject,
  getStringFromPayload,
} from "./sync-job-shared.server";

const CATALOG_RECONCILE_MAX_PRODUCTS = 2000;

const CATALOG_IMAGE_REPAIR_DEFAULT_LIMIT = 20;

const CATALOG_IMAGE_REPAIR_MAX_LIMIT = 100;

const FACET_BACKFILL_MAX_ACTIVE_BATCHES = 2;

const INCREMENTAL_SYNC_BATCH_SIZE = RUNNER_EBAY_ITEM_BATCH_SIZE;

const INCREMENTAL_SYNC_MAX_ATTEMPTS = 3;

const RUNNING_SYNC_JOB_STALE_AFTER_MS = 15 * 60 * 1000;

const STALE_RUNNING_SYNC_JOB_ERROR_CODE = "SYNCBAY_RUNNING_JOB_STALE";

const STALE_RUNNING_SYNC_JOB_ERROR_MESSAGE =
  "Job SyncBay rimasto RUNNING oltre la finestra di sicurezza del runner.";

export async function countDueSyncJobsByType(now: Date) {
  const counts = buildRunnerLaneCounts([]);
  const rows = await prisma.syncJob.groupBy({
    _count: { _all: true },
    by: ["type"],
    where: {
      ...getSchedulableSyncJobWhere(),
      runAfter: { lte: now },
      status: { in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING] },
    },
  });

  for (const row of rows) {
    if (RUNNER_LANES.includes(row.type as RunnerLane)) {
      counts[row.type as RunnerLane] = row._count._all;
    }
  }

  return counts;
}

export function buildRunnerLaneCounts(lanes: RunnerLane[]) {
  const counts = Object.fromEntries(RUNNER_LANES.map((lane) => [lane, 0])) as Record<
    RunnerLane,
    number
  >;

  for (const lane of lanes) counts[lane] += 1;

  return counts;
}

export async function findDueSyncJobsByPriority(input: { lanePlan: RunnerLane[]; now: Date }) {
  const jobs: DueSyncJob[] = [];

  for (const lane of input.lanePlan) {
    const type = lane as SyncJobType;
    if (type === SyncJobType.SYNC_INCREMENTAL) {
      const selectedIncrementalJobs = jobs.filter(
        (job) => job.type === SyncJobType.SYNC_INCREMENTAL,
      ).length;
      const regularJobs = await findDueRegularIncrementalSyncJobs({
        excludeIds: jobs.map((job) => job.id),
        limit: 1,
        now: input.now,
        prioritizeNonReconcile: shouldPrioritizeNonReconcileIncrementalJob(selectedIncrementalJobs),
      });
      jobs.push(...regularJobs);

      if (regularJobs.length === 0) {
        const facetOnlyJobs = await findDueSyncJobsForType({
          excludeIds: jobs.map((job) => job.id),
          limit: 1,
          now: input.now,
          type,
          where: getFacetOnlyIncrementalSyncJobWhere(),
        });
        jobs.push(...facetOnlyJobs);
      }
      continue;
    }

    const typedJobs = await findDueSyncJobsForType({
      excludeIds: jobs.map((job) => job.id),
      limit: 1,
      now: input.now,
      type,
    });
    jobs.push(...typedJobs);
  }

  return jobs;
}

// Un reconcile catalogo si spezza in decine di batch con lo stesso `runAfter`:
// in FIFO puro precedono ogni delta eventi accodato dopo, quindi la corsia live
// eBay -> Shopify resta ferma finché il giro non è drenato (ore, a pochi batch
// per tick). I delta sono anche gli unici job che fanno avanzare il watermark di
// verifica catalogo, quindi nel frattempo la UI marca l'intero catalogo come
// "Da controllare". Il secondo slot incrementale resta FIFO per far avanzare il
// reconcile già aperto; tutti gli altri privilegiano i delta live, così i batch
// dello stesso delta non slittano ai tick successivi.
async function findDueRegularIncrementalSyncJobs(input: {
  excludeIds?: string[];
  limit: number;
  now: Date;
  prioritizeNonReconcile: boolean;
}) {
  if (input.limit <= 0) return [];

  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "SyncJob"
    WHERE "type"::text = ${SyncJobType.SYNC_INCREMENTAL}
      AND "status"::text IN (${Prisma.join([SyncJobStatus.PENDING, SyncJobStatus.RETRYING])})
      AND "runAfter" <= ${input.now}
      AND NOT COALESCE("payload" @> '{"facetOnly": true}'::jsonb, false)
      AND COALESCE("payload"->>'source', '') <> ${FACET_BACKFILL_INCREMENTAL_JOB_SOURCE}
      ${
        input.excludeIds?.length
          ? Prisma.sql`AND "id" NOT IN (${Prisma.join(input.excludeIds)})`
          : Prisma.empty
      }
    ORDER BY
      ${
        input.prioritizeNonReconcile
          ? Prisma.sql`(COALESCE("payload"->>'source', '') = ${CATALOG_RECONCILE_JOB_SOURCE}) ASC,`
          : Prisma.empty
      }
      "runAfter" ASC,
      "createdAt" ASC
    LIMIT ${input.limit}
  `);

  return findDueSyncJobsByIds(rows.map((row) => row.id));
}

async function findDueSyncJobsByIds(ids: string[]) {
  if (ids.length === 0) return [];

  const jobs = await prisma.syncJob.findMany({
    select: dueSyncJobSelect,
    where: { id: { in: ids } },
  });
  const jobById = new Map(jobs.map((job) => [job.id, job]));

  return ids.flatMap((id) => {
    const job = jobById.get(id);

    return job ? [job] : [];
  });
}

async function findDueSyncJobsForType(input: {
  excludeIds?: string[];
  limit: number;
  now: Date;
  type: SyncJobType;
  where?: Prisma.SyncJobWhereInput;
}) {
  return prisma.syncJob.findMany({
    orderBy: [{ runAfter: "asc" }, { createdAt: "asc" }],
    select: dueSyncJobSelect,
    take: input.limit,
    where: {
      ...getSchedulableSyncJobWhere(),
      id: { notIn: input.excludeIds ?? [] },
      ...(input.where ?? {}),
      runAfter: { lte: input.now },
      status: { in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING] },
      type: input.type,
    },
  });
}

export async function claimDueSyncJob(job: DueSyncJob, now: Date) {
  if (
    !isSchedulableSyncJob({
      idempotencyKey: job.idempotencyKey,
      payload: job.payload,
    })
  ) {
    return null;
  }

  return prisma.$transaction(async (tx) => {
    await lockShopForUpdate(tx, job.shopId);

    const recoveredStaleJobCount = await recoverStaleRunningSyncJobs(tx, {
      now,
      shopId: job.shopId,
    });

    if (recoveredStaleJobCount > 0) return null;

    const runningJob = await tx.syncJob.findFirst({
      select: { id: true },
      where: {
        id: { not: job.id },
        shopId: job.shopId,
        status: SyncJobStatus.RUNNING,
        ...getSchedulableSyncJobWhere(),
        type: { in: getRunnableSyncJobTypes() },
      },
    });

    if (runningJob) return null;

    const claimed = await tx.syncJob.updateMany({
      data: {
        errorCode: null,
        errorMessage: null,
        finishedAt: null,
        startedAt: now,
        status: SyncJobStatus.RUNNING,
      },
      where: {
        id: job.id,
        runAfter: { lte: now },
        shop: {
          installationStatus: ShopInstallationStatus.INSTALLED,
        },
        shopId: job.shopId,
        status: { in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING] },
        ...getSchedulableSyncJobWhere(),
        type: { in: getRunnableSyncJobTypes() },
      },
    });

    if (claimed.count !== 1) return null;

    return tx.syncJob.findUniqueOrThrow({
      select: dueSyncJobSelect,
      where: { id: job.id },
    });
  });
}

export async function recoverStaleRunningSyncJobsForDueShops(input: { limit: number; now: Date }) {
  const staleCutoff = getRunningSyncJobStaleCutoff(input.now);
  const staleRunningJobs = await prisma.syncJob.findMany({
    orderBy: [{ startedAt: "asc" }, { createdAt: "asc" }],
    select: { shopId: true },
    take: input.limit,
    where: getStaleRunningSyncJobWhere(staleCutoff),
  });
  const staleShopIds = [...new Set(staleRunningJobs.map((job) => job.shopId))];

  await Promise.all(
    staleShopIds.map((shopId) =>
      prisma.$transaction(async (tx) => {
        await lockShopForUpdate(tx, shopId);
        await recoverStaleRunningSyncJobs(tx, {
          now: input.now,
          shopId,
        });
      }),
    ),
  );
}

export async function archiveSupersededFailedIncrementalSyncJobs(input: { now: Date }) {
  const failedJobShops = await prisma.syncJob.findMany({
    distinct: ["shopId"],
    select: { shopId: true },
    where: {
      errorCode: { in: [...STALE_FAILED_INCREMENTAL_SYNC_ERROR_CODES] },
      status: SyncJobStatus.FAILED,
      type: SyncJobType.SYNC_INCREMENTAL,
    },
  });
  const archivedCounts = await mapWithConcurrency(failedJobShops, 5, async ({ shopId }) => {
    const latestSuccessfulIncrementalSync = await prisma.syncJob.findFirst({
      orderBy: [{ finishedAt: "desc" }, { updatedAt: "desc" }],
      select: { finishedAt: true, updatedAt: true },
      where: {
        shopId,
        status: SyncJobStatus.SUCCEEDED,
        type: SyncJobType.SYNC_INCREMENTAL,
      },
    });
    const latestSuccessAt =
      latestSuccessfulIncrementalSync?.finishedAt ?? latestSuccessfulIncrementalSync?.updatedAt;

    if (!latestSuccessAt) return 0;

    const archiveCutoff = new Date(
      input.now.getTime() - STALE_FAILED_INCREMENTAL_SYNC_ARCHIVE_AFTER_MS,
    );
    const archived = await prisma.syncJob.updateMany({
      data: { status: SyncJobStatus.CANCELLED },
      where: {
        errorCode: { in: [...STALE_FAILED_INCREMENTAL_SYNC_ERROR_CODES] },
        shopId,
        status: SyncJobStatus.FAILED,
        type: SyncJobType.SYNC_INCREMENTAL,
        updatedAt: { lt: latestSuccessAt, lte: archiveCutoff },
      },
    });

    return archived.count;
  });

  return archivedCounts.reduce((total, count) => total + count, 0);
}

async function lockShopForUpdate(tx: Prisma.TransactionClient, shopId: string) {
  // Serialize claims and stale recovery for the same shop across Cron invocations.
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "Shop"
    WHERE id = ${shopId}
    FOR UPDATE
  `;
}

export async function enqueueIncrementalSyncJobs(now: Date) {
  const shops = await prisma.shop.findMany({
    select: {
      ebayConnections: {
        where: {
          marketplaceId: DEFAULT_MARKETPLACE_ID,
          status: EbayConnectionStatus.CONNECTED,
        },
      },
      id: true,
      syncTargetSeconds: true,
    },
    where: {
      installationStatus: "INSTALLED",
      syncEnabled: true,
    },
  });

  for (const shop of shops) {
    if (shop.ebayConnections.length === 0) continue;

    await cancelCatalogReconcileRuns({ now, shopId: shop.id });

    const activeJob = await prisma.syncJob.findFirst({
      select: { id: true },
      where: {
        NOT: [
          {
            AND: [{ type: SyncJobType.SYNC_INCREMENTAL }, getFacetOnlyIncrementalSyncJobWhere()],
          },
        ],
        ...getSchedulableSyncJobWhere(),
        shopId: shop.id,
        status: {
          in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING, SyncJobStatus.RUNNING],
        },
        type: {
          in: [
            SyncJobType.IMPORT_CATALOG,
            SyncJobType.SYNC_INCREMENTAL,
            SyncJobType.ARCHIVE_INACTIVE_LISTING,
          ],
        },
      },
    });

    if (activeJob) continue;

    await enqueueFacetBackfillJobsIfNeeded({
      now,
      shopId: shop.id,
    });

    const lastJob = await prisma.syncJob.findFirst({
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
      select: { createdAt: true, finishedAt: true, runAfter: true },
      where: {
        ...getRegularIncrementalSyncJobWhere(),
        shopId: shop.id,
        type: SyncJobType.SYNC_INCREMENTAL,
      },
    });
    const nextRunAfter = getNextIncrementalEnqueueAt({
      latestJob: lastJob,
      now,
      syncTargetSeconds: shop.syncTargetSeconds,
    });

    if (
      !shouldEnqueueIncrementalSyncNow({
        nextRunAfter,
        now,
      })
    ) {
      continue;
    }

    try {
      const connection = shop.ebayConnections[0];
      const { accessToken } = await getUsableEbayAccessToken(connection);
      const [latestSellerEventsSyncJob, latestFullReconcileJob] = await Promise.all([
        prisma.syncJob.findFirst({
          orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
          select: { createdAt: true, finishedAt: true, payload: true },
          where: {
            AND: [
              {
                payload: { path: ["source"], equals: "seller_events_delta" },
              },
              { payload: { path: ["watermarkAdvanced"], equals: true } },
            ],
            shopId: shop.id,
            status: SyncJobStatus.SUCCEEDED,
            type: SyncJobType.SYNC_INCREMENTAL,
          },
        }),
        prisma.syncJob.findFirst({
          orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
          select: { createdAt: true, finishedAt: true, payload: true },
          where: {
            payload: { path: ["source"], equals: "catalog_reconcile" },
            shopId: shop.id,
            status: SyncJobStatus.SUCCEEDED,
            type: SyncJobType.SYNC_INCREMENTAL,
          },
        }),
      ]);
      const latestFullReconcileAt = getJobCompletionTime(latestFullReconcileJob);
      const latestFullReconcileWatermarkAt =
        getDateFromPayload(latestFullReconcileJob?.payload ?? null, "activeCatalogReadAt") ??
        latestFullReconcileJob?.createdAt ??
        latestFullReconcileAt;
      const fullReconcileDue = isFullCatalogReconcileDue({
        intervalSecondsValue: process.env.SYNCBAY_EBAY_FULL_RECONCILE_INTERVAL_SECONDS,
        latestFullReconcileAt,
        now,
      });
      const sellerEventsWindow = fullReconcileDue
        ? null
        : getSellerEventsDeltaWindow({
            latestSuccessfulSyncAt: getSellerEventsWatermarkAt({
              latestFullReconcileCompletedAt: latestFullReconcileAt,
              latestFullReconcileWatermarkAt,
              latestSellerEventsCompletedAt: getJobCompletionTime(latestSellerEventsSyncJob),
              latestSellerEventsModTimeToValue: getStringFromPayload(
                latestSellerEventsSyncJob?.payload ?? null,
                "modTimeTo",
              ),
            }),
            now,
          });

      if (sellerEventsWindow) {
        await enqueueSellerEventsDeltaSyncJobs({
          accessToken,
          connection,
          modTimeFrom: sellerEventsWindow.modTimeFrom,
          modTimeTo: sellerEventsWindow.modTimeTo,
          now,
          shopId: shop.id,
        });
        continue;
      }

      await enqueueFullCatalogReconcileSyncJobs({
        accessToken,
        connection,
        now,
        shopId: shop.id,
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      const retryScheduledAt = isEbayTradingUsageLimitError(errorMessage)
        ? getNextEbayTradingRateLimitRetryAt({
            cooldownSecondsValue: process.env.SYNCBAY_EBAY_TRADING_RATE_LIMIT_COOLDOWN_SECONDS,
            now,
          })
        : null;
      const rateLimitCooldownSeconds = retryScheduledAt
        ? Math.ceil((retryScheduledAt.getTime() - now.getTime()) / 1000)
        : 0;
      const result = {
        failedBeforeEnqueue: true,
        rateLimitCooldownSeconds,
        runnerErrorCode: "SYNCBAY_INCREMENTAL_ENQUEUE_FAILED",
        runnerErrorMessage: errorMessage,
        retryScheduledAt: retryScheduledAt?.toISOString() ?? null,
        willRetry: Boolean(retryScheduledAt),
      } satisfies Prisma.JsonObject;

      await prisma.$transaction([
        prisma.syncJob.create({
          data: {
            attempts: 1,
            errorCode: "SYNCBAY_INCREMENTAL_ENQUEUE_FAILED",
            errorMessage,
            finishedAt: now,
            maxAttempts: 1,
            payload: {
              marketplaceId: DEFAULT_MARKETPLACE_ID,
              source: "catalog_reconcile_enqueue",
            } satisfies Prisma.JsonObject,
            result,
            runAfter: retryScheduledAt ?? now,
            shopId: shop.id,
            status: SyncJobStatus.FAILED,
            type: SyncJobType.SYNC_INCREMENTAL,
          },
        }),
        prisma.auditLog.create({
          select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
          data: {
            details: result,
            message:
              "Pianificazione sync catalogo incrementale non completata; il runner continuerà con i job già in coda.",
            shopId: shop.id,
            type: AuditEventType.SYNC_JOB_FAILED,
          },
        }),
      ]);
    }
  }
}

async function enqueueFullCatalogReconcileSyncJobs(input: {
  accessToken: string;
  connection: EbayConnection;
  now: Date;
  shopId: string;
}) {
  const activeCatalogReadAt = new Date();
  const [activeCatalogPlan, mappings] = await Promise.all([
    getEbayTradingCatalogImportPlan({
      accessToken: input.accessToken,
      connection: input.connection,
      maxProducts: CATALOG_RECONCILE_MAX_PRODUCTS,
    }),
    prisma.productMapping.findMany({
      orderBy: { updatedAt: "asc" },
      select: { ebayItemId: true },
      where: {
        marketplaceId: DEFAULT_MARKETPLACE_ID,
        shopId: input.shopId,
        status: ProductMappingStatus.ACTIVE,
      },
    }),
  ]);
  const activeScanComplete = isCatalogReconcileScanComplete({
    itemIds: activeCatalogPlan.itemIds,
    maxProducts: CATALOG_RECONCILE_MAX_PRODUCTS,
    readCount: activeCatalogPlan.readCount,
    totalAvailable: activeCatalogPlan.totalAvailable,
  });
  const reconcilePlan = buildCatalogReconcilePlan({
    activeEbayItemIds: activeCatalogPlan.itemIds,
    activeScanComplete,
    batchSize: INCREMENTAL_SYNC_BATCH_SIZE,
    mappedEbayItemIds: mappings.map((mapping) => mapping.ebayItemId),
  });

  if (reconcilePlan.syncBatches.length === 0 && reconcilePlan.inactiveEbayItemIds.length === 0) {
    await createIncrementalNoopMarker({
      now: input.now,
      payload: {
        activeCatalogReadAt: activeCatalogReadAt.toISOString(),
        activeCatalogReadCount: activeCatalogPlan.readCount,
        activeCatalogTotalAvailable: activeCatalogPlan.totalAvailable,
        activeScanComplete,
        marketplaceId: DEFAULT_MARKETPLACE_ID,
        source: "catalog_reconcile",
      },
      result: {
        activeCatalogReadAt: activeCatalogReadAt.toISOString(),
        activeCatalogReadCount: activeCatalogPlan.readCount,
        activeCatalogTotalAvailable: activeCatalogPlan.totalAvailable,
        noWork: true,
        source: "catalog_reconcile",
      },
      shopId: input.shopId,
    });
    return;
  }

  const runId = `incremental:${input.shopId}:${input.now.toISOString()}`;
  const syncJobs = reconcilePlan.syncBatches.map((ebayItemIds, index) => ({
    maxAttempts: INCREMENTAL_SYNC_MAX_ATTEMPTS,
    payload: {
      activeCatalogReadAt: activeCatalogReadAt.toISOString(),
      activeCatalogReadCount: activeCatalogPlan.readCount,
      activeCatalogTotalAvailable: activeCatalogPlan.totalAvailable,
      activeScanComplete,
      batchCount: reconcilePlan.syncBatches.length,
      batchIndex: index + 1,
      ebayItemIds,
      marketplaceId: DEFAULT_MARKETPLACE_ID,
      runId,
      source: "catalog_reconcile",
    } satisfies Prisma.JsonObject,
    runAfter: input.now,
    shopId: input.shopId,
    status: SyncJobStatus.PENDING,
    type: SyncJobType.SYNC_INCREMENTAL,
  }));
  const archiveJobs = reconcilePlan.inactiveEbayItemIds.map((ebayItemId) => ({
    idempotencyKey: `archive-inactive:${input.shopId}:${DEFAULT_MARKETPLACE_ID}:${ebayItemId}:${runId}`,
    maxAttempts: INCREMENTAL_SYNC_MAX_ATTEMPTS,
    payload: {
      activeCatalogReadAt: activeCatalogReadAt.toISOString(),
      activeCatalogReadCount: activeCatalogPlan.readCount,
      activeCatalogTotalAvailable: activeCatalogPlan.totalAvailable,
      ebayItemId,
      marketplaceId: DEFAULT_MARKETPLACE_ID,
      runId,
      source: "catalog_reconcile",
    } satisfies Prisma.JsonObject,
    runAfter: input.now,
    shopId: input.shopId,
    status: SyncJobStatus.PENDING,
    type: SyncJobType.ARCHIVE_INACTIVE_LISTING,
  }));

  await prisma.$transaction(async (tx) => {
    await lockShopForUpdate(tx, input.shopId);
    await cancelCatalogReconcileRuns({
      client: tx,
      mode: "before_new_run",
      now: input.now,
      shopId: input.shopId,
    });
    await tx.syncJob.createMany({
      data: [...syncJobs, ...archiveJobs],
      skipDuplicates: true,
    });
  });
}

// I giri reconcile obsoleti vanno annullati PRIMA della guardia `activeJob` di
// enqueueIncrementalSyncJobs: quella guardia salta l'intero enqueue quando trova
// job SYNC_INCREMENTAL/ARCHIVE in coda, quindi un supersede fatto solo alla
// creazione di un nuovo giro non verrebbe mai raggiunto se il backlog esiste già.
// Girando a ogni tick, mantiene un solo giro reconcile (il più recente) anche se
// la guardia viene aggirata durante un blackout auth/API. No-op quando c'è un
// solo giro aperto.
async function cancelCatalogReconcileRuns(input: {
  client?: Pick<Prisma.TransactionClient, "syncJob">;
  mode?: "before_new_run" | "superseded";
  now: Date;
  shopId: string;
}) {
  const client = input.client ?? prisma;
  const openReconcileJobs = await client.syncJob.findMany({
    select: { createdAt: true, id: true, payload: true },
    where: {
      payload: { path: ["source"], equals: "catalog_reconcile" },
      shopId: input.shopId,
      status: { in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING] },
      type: {
        in: [SyncJobType.SYNC_INCREMENTAL, SyncJobType.ARCHIVE_INACTIVE_LISTING],
      },
    },
  });
  const supersededJobIds =
    input.mode === "before_new_run"
      ? getCatalogReconcileJobIdsToCancelBeforeNewRun({
          jobs: openReconcileJobs,
        })
      : getSupersededCatalogReconcileJobIds({ jobs: openReconcileJobs });

  if (supersededJobIds.length === 0) return;

  await client.syncJob.updateMany({
    data: {
      finishedAt: input.now,
      result: { reason: "superseded_by_newer_catalog_reconcile_run" },
      status: SyncJobStatus.CANCELLED,
    },
    where: {
      id: { in: supersededJobIds },
      status: { in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING] },
    },
  });
}

async function enqueueCatalogImageRepairSyncJobs(input: { now: Date; shopId: string }) {
  const limit = getCatalogImageRepairLimit(process.env.SYNCBAY_CATALOG_IMAGE_REPAIR_LIMIT);

  if (limit === 0) return 0;

  const mappings = await prisma.productMapping.findMany({
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    select: {
      ebayItemId: true,
      shopifyProductGid: true,
      thumbnailUrl: true,
    },
    take: Math.min(limit * 2, CATALOG_RECONCILE_MAX_PRODUCTS),
    where: getCatalogImageRepairCandidateWhere({
      activeStatus: ProductMappingStatus.ACTIVE,
      marketplaceId: DEFAULT_MARKETPLACE_ID,
      openConflictStatus: SyncConflictStatus.OPEN,
      shopId: input.shopId,
    }),
  });
  const ebayItemIds = getCatalogImageRepairItemIds({
    limit,
    mappings: mappings.map((mapping) => ({
      ebayItemId: mapping.ebayItemId,
      hasThumbnailUrl: Boolean(mapping.thumbnailUrl),
      shopifyProductGid: mapping.shopifyProductGid,
    })),
  });

  if (ebayItemIds.length === 0) return 0;

  const repairRunKey = getCatalogImageRepairRunKey(input.now);
  const runId = `catalog-image-repair:${input.shopId}:${repairRunKey}`;
  const result = await prisma.syncJob.createMany({
    data: ebayItemIds.map((ebayItemId, index) => ({
      idempotencyKey: `catalog-image-repair:${input.shopId}:${DEFAULT_MARKETPLACE_ID}:${repairRunKey}:${ebayItemId}`,
      maxAttempts: INCREMENTAL_SYNC_MAX_ATTEMPTS,
      payload: {
        batchCount: ebayItemIds.length,
        batchIndex: index + 1,
        ebayItemIds: [ebayItemId],
        marketplaceId: DEFAULT_MARKETPLACE_ID,
        repairReason: "missing_catalog_thumbnail",
        repairRunKey,
        runId,
        source: "catalog_image_repair",
      } satisfies Prisma.JsonObject,
      runAfter: input.now,
      shopId: input.shopId,
      status: SyncJobStatus.PENDING,
      type: SyncJobType.SYNC_INCREMENTAL,
    })),
    skipDuplicates: true,
  });

  return result.count;
}

async function enqueueFacetBackfillJobsIfNeeded(input: { now: Date; shopId: string }) {
  const version = 1;
  const runId = `${input.shopId}:${DEFAULT_MARKETPLACE_ID}:v${version}`;
  const completedMarker = await prisma.syncJob.findFirst({
    select: { id: true },
    where: {
      AND: [
        { payload: { path: ["source"], equals: "facet_backfill_marker" } },
        { payload: { path: ["facetBackfillRunId"], equals: runId } },
      ],
      shopId: input.shopId,
      status: SyncJobStatus.SUCCEEDED,
      type: SyncJobType.SYNC_INCREMENTAL,
    },
  });
  if (completedMarker) return 0;

  const mappings = await prisma.productMapping.findMany({
    orderBy: { updatedAt: "asc" },
    select: { ebayItemId: true },
    take: CATALOG_RECONCILE_MAX_PRODUCTS,
    where: {
      marketplaceId: DEFAULT_MARKETPLACE_ID,
      shopId: input.shopId,
      shopifyProductGid: { not: null },
      status: ProductMappingStatus.ACTIVE,
    },
  });
  const ebayItemIds = mappings.map((mapping) => mapping.ebayItemId);

  if (ebayItemIds.length === 0) return 0;

  const batches = chunkArray(ebayItemIds, INCREMENTAL_SYNC_BATCH_SIZE);
  const activeBatchCount = await prisma.syncJob.count({
    where: {
      AND: [
        { payload: { path: ["source"], equals: "facet_backfill" } },
        { payload: { path: ["facetBackfillRunId"], equals: runId } },
      ],
      shopId: input.shopId,
      status: {
        in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING, SyncJobStatus.RUNNING],
      },
      type: SyncJobType.SYNC_INCREMENTAL,
    },
  });
  const availableSlots = FACET_BACKFILL_MAX_ACTIVE_BATCHES - activeBatchCount;

  if (availableSlots <= 0) return 0;

  const existingJobs = await prisma.syncJob.findMany({
    select: { payload: true },
    where: {
      AND: [
        { payload: { path: ["source"], equals: "facet_backfill" } },
        { payload: { path: ["facetBackfillRunId"], equals: runId } },
      ],
      shopId: input.shopId,
      type: SyncJobType.SYNC_INCREMENTAL,
    },
  });
  const existingBatchIndexes = new Set(
    existingJobs.flatMap((job) => {
      const batchIndex = getJsonNumber(getJsonObject(job.payload)?.batchIndex);

      return batchIndex === null ? [] : [batchIndex];
    }),
  );
  const jobsToCreate: Array<{
    batch: (typeof batches)[number];
    batchIndex: number;
  }> = [];
  for (const [index, batch] of batches.entries()) {
    if (jobsToCreate.length >= availableSlots) break;
    const batchIndex = index + 1;
    if (existingBatchIndexes.has(batchIndex)) continue;
    jobsToCreate.push({ batch, batchIndex });
  }

  if (jobsToCreate.length === 0) return 0;

  const result = await prisma.syncJob.createMany({
    data: jobsToCreate.map(({ batch, batchIndex }) => ({
      idempotencyKey: `facet-backfill:${runId}:${batchIndex}`,
      maxAttempts: INCREMENTAL_SYNC_MAX_ATTEMPTS,
      payload: {
        batchCount: batches.length,
        batchIndex,
        ebayItemIds: batch,
        facetBackfillRunId: runId,
        facetBackfillVersion: version,
        facetOnly: true,
        marketplaceId: DEFAULT_MARKETPLACE_ID,
        source: "facet_backfill",
      } satisfies Prisma.JsonObject,
      runAfter: input.now,
      shopId: input.shopId,
      status: SyncJobStatus.PENDING,
      type: SyncJobType.SYNC_INCREMENTAL,
    })),
    skipDuplicates: true,
  });

  return result.count;
}

async function enqueueSellerEventsDeltaSyncJobs(input: {
  accessToken: string;
  connection: EbayConnection;
  modTimeFrom: Date;
  modTimeTo: Date;
  now: Date;
  shopId: string;
}) {
  const delta = await getEbayTradingSellerEventsDelta({
    accessToken: input.accessToken,
    connection: input.connection,
    maxEvents: CATALOG_RECONCILE_MAX_PRODUCTS,
    modTimeFrom: input.modTimeFrom,
    modTimeTo: input.modTimeTo,
  });

  if (delta.truncated) {
    await enqueueFullCatalogReconcileSyncJobs(input);
    return;
  }

  const candidates = dedupePreviewCandidates(delta.candidates);
  const candidateBatches = chunkArray(candidates, INCREMENTAL_SYNC_BATCH_SIZE);
  const runId = `seller-events:${input.shopId}:${input.now.toISOString()}`;

  if (candidateBatches.length === 0 && delta.inactiveItemIds.length === 0) {
    const imageRepairJobCount = await enqueueCatalogImageRepairSyncJobs({
      now: input.now,
      shopId: input.shopId,
    });
    const marker = buildSellerEventsNoopMarker({
      eventReadCount: delta.readCount,
      imageRepairJobCount,
      marketplaceId: DEFAULT_MARKETPLACE_ID,
      modTimeFrom: delta.timeFrom,
      modTimeTo: delta.timeTo,
    });

    await createIncrementalNoopMarker({
      now: input.now,
      payload: marker.payload,
      result: marker.result,
      shopId: input.shopId,
    });
    return;
  }

  const syncJobs = candidateBatches.map((batch, index) => ({
    maxAttempts: INCREMENTAL_SYNC_MAX_ATTEMPTS,
    payload: {
      batchCount: candidateBatches.length,
      batchIndex: index + 1,
      ebayItemIds: batch.map((candidate) => candidate.itemId),
      eventReadCount: delta.readCount,
      marketplaceId: DEFAULT_MARKETPLACE_ID,
      modTimeFrom: delta.timeFrom,
      modTimeTo: delta.timeTo,
      previewCandidates: batch.map(serializePreviewCandidate),
      runId,
      source: "seller_events_delta",
    } satisfies Prisma.JsonObject,
    runAfter: input.now,
    shopId: input.shopId,
    status: SyncJobStatus.PENDING,
    type: SyncJobType.SYNC_INCREMENTAL,
  }));
  const archiveJobs = delta.inactiveItemIds.map((ebayItemId) => ({
    idempotencyKey: `archive-inactive:${input.shopId}:${DEFAULT_MARKETPLACE_ID}:${ebayItemId}:${runId}`,
    maxAttempts: INCREMENTAL_SYNC_MAX_ATTEMPTS,
    payload: {
      archiveOnly: syncJobs.length === 0,
      ebayItemId,
      eventReadCount: delta.readCount,
      marketplaceId: DEFAULT_MARKETPLACE_ID,
      modTimeFrom: delta.timeFrom,
      modTimeTo: delta.timeTo,
      runId,
      source: "seller_events_delta",
    } satisfies Prisma.JsonObject,
    runAfter: input.now,
    shopId: input.shopId,
    status: SyncJobStatus.PENDING,
    type: SyncJobType.ARCHIVE_INACTIVE_LISTING,
  }));
  await prisma.syncJob.createMany({
    data: [...syncJobs, ...archiveJobs],
    skipDuplicates: true,
  });
}

async function createIncrementalNoopMarker(input: {
  now: Date;
  payload: Prisma.JsonObject;
  result: Prisma.JsonObject;
  shopId: string;
}) {
  await prisma.syncJob.create({
    data: {
      attempts: 1,
      finishedAt: input.now,
      maxAttempts: 1,
      payload: input.payload,
      result: input.result,
      runAfter: input.now,
      shopId: input.shopId,
      status: SyncJobStatus.SUCCEEDED,
      type: SyncJobType.SYNC_INCREMENTAL,
    },
  });
}

function getJobCompletionTime(job: { createdAt: Date; finishedAt: Date | null } | null) {
  return job ? (job.finishedAt ?? job.createdAt) : null;
}

function dedupePreviewCandidates(candidates: ImportPreviewListingCandidate[]) {
  const candidatesById = new Map<string, ImportPreviewListingCandidate>();

  for (const candidate of candidates) {
    candidatesById.set(candidate.itemId, candidate);
  }

  return [...candidatesById.values()];
}

function serializePreviewCandidate(candidate: ImportPreviewListingCandidate) {
  return serializeIncrementalPreviewCandidate(candidate);
}

function getCatalogImageRepairLimit(value?: string | null) {
  const normalized = value?.trim();

  if (normalized === "0") return 0;

  const parsed = Number.parseInt(normalized ?? "", 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return CATALOG_IMAGE_REPAIR_DEFAULT_LIMIT;
  }

  return Math.min(parsed, CATALOG_IMAGE_REPAIR_MAX_LIMIT);
}

export async function recoverStaleRunningSyncJobs(
  tx: Prisma.TransactionClient,
  input: {
    now: Date;
    shopId: string;
  },
): Promise<number> {
  const staleCutoff = getRunningSyncJobStaleCutoff(input.now);
  const staleJobs = await tx.syncJob.findMany({
    select: {
      attempts: true,
      id: true,
      maxAttempts: true,
      runAfter: true,
      startedAt: true,
      type: true,
    },
    where: getStaleRunningSyncJobWhere(staleCutoff, input.shopId),
  });
  let recoveredCount = 0;
  const recoveredJobSummaries: Prisma.JsonObject[] = [];

  for (const staleJob of staleJobs) {
    const nextAttempts = staleJob.attempts + 1;
    const retryAt = nextAttempts < staleJob.maxAttempts ? staleJob.runAfter : null;
    const result = {
      recoveredJobType: staleJob.type,
      runnerErrorCode: STALE_RUNNING_SYNC_JOB_ERROR_CODE,
      runnerErrorMessage: STALE_RUNNING_SYNC_JOB_ERROR_MESSAGE,
      staleAfterSeconds: RUNNING_SYNC_JOB_STALE_AFTER_MS / 1000,
      staleStartedAt: staleJob.startedAt?.toISOString() ?? null,
      retryScheduledAt: retryAt?.toISOString() ?? null,
      willRetry: Boolean(retryAt),
    } satisfies Prisma.JsonObject;

    await tx.syncJob.update({
      data: {
        attempts: { increment: 1 },
        errorCode: STALE_RUNNING_SYNC_JOB_ERROR_CODE,
        errorMessage: STALE_RUNNING_SYNC_JOB_ERROR_MESSAGE,
        finishedAt: input.now,
        result,
        runAfter: retryAt ?? undefined,
        status: retryAt ? SyncJobStatus.RETRYING : SyncJobStatus.FAILED,
      },
      where: { id: staleJob.id },
    });

    recoveredJobSummaries.push({
      id: staleJob.id,
      retryScheduledAt: retryAt?.toISOString() ?? null,
      type: staleJob.type,
      willRetry: Boolean(retryAt),
    });
    recoveredCount += 1;
  }

  if (recoveredCount > 0) {
    await tx.auditLog.create({
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
      data: {
        details: {
          recoveredCount,
          recoveredJobs: recoveredJobSummaries,
          runnerErrorCode: STALE_RUNNING_SYNC_JOB_ERROR_CODE,
          staleAfterSeconds: RUNNING_SYNC_JOB_STALE_AFTER_MS / 1000,
        } satisfies Prisma.JsonObject,
        message: "Job SyncBay RUNNING stantii recuperati dal runner.",
        shopId: input.shopId,
        type: AuditEventType.SYNC_JOB_FAILED,
      },
    });
  }

  return recoveredCount;
}

function getRunningSyncJobStaleCutoff(now: Date) {
  return new Date(now.getTime() - RUNNING_SYNC_JOB_STALE_AFTER_MS);
}

function getStaleRunningSyncJobWhere(staleCutoff: Date, shopId?: string): Prisma.SyncJobWhereInput {
  return {
    AND: [
      getSchedulableSyncJobWhere(),
      { OR: [{ startedAt: null }, { startedAt: { lte: staleCutoff } }] },
    ],
    shopId,
    status: SyncJobStatus.RUNNING,
    type: { in: getRecoverableRunningSyncJobTypes(getRunnableSyncJobTypes()) },
  };
}

export function getSchedulableSyncJobWhere(): Prisma.SyncJobWhereInput {
  return {};
}

function getRegularIncrementalSyncJobWhere(): Prisma.SyncJobWhereInput {
  return {
    OR: [
      { payload: { path: ["source"], equals: "seller_events_delta" } },
      { payload: { path: ["source"], equals: "catalog_reconcile" } },
    ],
  };
}

function getFacetOnlyIncrementalSyncJobWhere(): Prisma.SyncJobWhereInput {
  return {
    payload: { path: ["facetOnly"], equals: true },
  };
}

function getDateFromPayload(payload: Prisma.JsonValue | null, key: string) {
  const value = getStringFromPayload(payload, key);
  if (!value) return null;

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function getRunnableSyncJobTypes() {
  return [
    SyncJobType.UPDATE_EBAY_STOCK,
    SyncJobType.SYNC_INCREMENTAL,
    SyncJobType.ARCHIVE_INACTIVE_LISTING,
    SyncJobType.DETECT_SHOPIFY_CHANGES,
    SyncJobType.IMPORT_CATALOG,
  ];
}

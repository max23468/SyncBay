import {
  AuditEventType,
  EbayConnection,
  EbayConnectionStatus,
  ProductMappingStatus,
  ProductSnapshotSource,
  Prisma,
  SyncConflictStatus,
  SyncJobStatus,
  SyncJobType,
} from "@prisma/client";

import prisma from "../db.server";
import { normalizeImportProductStatus } from "../lib/import-product-status";
import { getCatalogReconcileBlockingJobTypes } from "../lib/syncbay-catalog-reconcile-blockers";
import {
  getAlignedOpenConflictFields,
  getLatestSyncBayDescriptionBaselineWhere,
  isLiveDescriptionConflictAligned,
  shouldBlockIncrementalSyncForOpenConflictMappingStatus,
  shouldDetectShopifyConflictsForMappingStatus,
  shouldResolveLiveAlignedDescriptionConflictForMappingStatus,
  shouldResolveOpenConflictsForInactiveMappingStatus,
  shouldSkipImagesConflictWhenEbayHasNoImages,
  shouldSkipQuantityConflictForArchivedProduct,
  shouldUseSyncBayDescriptionBaselinePayload,
} from "../lib/syncbay-conflict-detection";
import {
  deserializeIncrementalPreviewCandidate,
  serializeIncrementalPreviewCandidate,
} from "../lib/syncbay-incremental-preview-candidate";
import {
  buildCatalogReconcilePlan,
  isCatalogReconcileScanComplete,
} from "../lib/syncbay-catalog-reconcile";
import {
  getCatalogImageRepairItemIds,
  getCatalogImageRepairRunKey,
} from "../lib/syncbay-catalog-image-repair";
import { hashNullableText } from "../lib/syncbay-description-hash";
import {
  getSellerEventsDeltaWindow,
  getSellerEventsWatermarkAt,
  isFullCatalogReconcileDue,
  shouldAdvanceSellerEventsRunWatermark,
} from "../lib/syncbay-ebay-delta-sync";
import {
  getNextEbayTradingRateLimitRetryAt,
  isEbayTradingUsageLimitError,
} from "../lib/syncbay-ebay-rate-limit";
import { getNextIncrementalEnqueueAt } from "../lib/syncbay-incremental-schedule";
import {
  buildEbayItemJobSplitIdempotencyKey,
  buildEbayItemJobSplitPayloads,
  isSchedulableSyncJob,
  isStaleInternalShopifyImportJob,
} from "../lib/syncbay-job-scheduling";
import { getProductSnapshotThumbnailUrlFromPayloads } from "../lib/syncbay-product-snapshot-payload";
import {
  STALE_FAILED_INCREMENTAL_SYNC_ARCHIVE_AFTER_MS,
  STALE_FAILED_INCREMENTAL_SYNC_ERROR_CODES,
} from "../lib/syncbay-stale-failed-job-archive";
import { getRecoverableRunningSyncJobTypes } from "../lib/syncbay-stale-job-recovery";
import { hasProcessedStockLineInJobResults } from "../lib/syncbay-stock-job-idempotency";
import {
  isEbayStockDryRunEnabled,
  shouldDryRunEbayStockLine,
  validateEbayStockCurrency,
  validateEbayStockOrderCurrency,
} from "../lib/syncbay-stock-guard";
import { getUsableEbayAccessToken } from "./ebay-token.server";
import {
  getEbayTradingCandidatesByItemIds,
  getEbayTradingCatalogImportPlan,
  getEbayTradingSellerEventsDelta,
} from "./ebay-trading-preview.server";
import { reviseEbayTradingInventoryQuantity } from "./ebay-trading-stock.server";
import { getShopifyAdminGraphqlClient } from "./shopify-admin-session.server";
import type {
  ImportPreviewListingCandidate,
  ImportPreviewItem,
  ImportPreviewResult,
  ImportPreviewSummary,
} from "./import-preview.server";
import { buildImportPreview } from "./import-preview.server";
import {
  createShopifyDraftProductsIfEnabled,
  markShopifyProductSoldOut,
} from "./shopify-draft-import.server";

type DueSyncJob = Prisma.SyncJobGetPayload<{ include: { shop: true } }>;
type DueSyncJobRunResult = {
  errorMessage?: string;
  jobId: string;
  status: "failed" | "skipped" | "succeeded";
  type: SyncJobType;
};
type DueSyncJobRunQueueItem = {
  index: number;
  job: DueSyncJob;
};
type ShopifyProductForConflict = {
  descriptionHtml?: string | null;
  id: string;
  media?: {
    nodes?: Array<{
      mediaContentType?: string | null;
      preview?: { status?: string | null } | null;
    }>;
  } | null;
  status?: string | null;
  title?: string | null;
  variants?: {
    nodes?: Array<{
      inventoryItem?: {
        inventoryLevel?: {
          quantities?: Array<{
            name?: string | null;
            quantity?: number | null;
          }> | null;
        } | null;
        tracked?: boolean | null;
      } | null;
      inventoryQuantity?: number | null;
      price?: string | null;
    }>;
  } | null;
};
type ShopifyProductForConflictResponse = {
  data?: {
    node?: ShopifyProductForConflict | null;
  };
  errors?: Array<{ message: string }>;
};
const DEFAULT_RUN_DUE_LIMIT = 5;
const MAX_RUN_DUE_LIMIT = 10;
const DEFAULT_MARKETPLACE_ID = "EBAY_IT";
const CATALOG_RECONCILE_MAX_PRODUCTS = 2000;
const RUNNER_EBAY_ITEM_BATCH_SIZE = 10;
const CATALOG_IMAGE_REPAIR_DEFAULT_LIMIT = 20;
const CATALOG_IMAGE_REPAIR_MAX_LIMIT = 100;
const CATALOG_IMAGE_REPAIR_SNAPSHOT_LOOKBACK = 5;
const INCREMENTAL_SYNC_BATCH_SIZE = RUNNER_EBAY_ITEM_BATCH_SIZE;
const INCREMENTAL_SYNC_MAX_ATTEMPTS = 3;
const RUNNING_SYNC_JOB_STALE_AFTER_MS = 15 * 60 * 1000;
const STALE_RUNNING_SYNC_JOB_ERROR_CODE = "SYNCBAY_RUNNING_JOB_STALE";
const STALE_RUNNING_SYNC_JOB_ERROR_MESSAGE =
  "Job SyncBay rimasto RUNNING oltre la finestra di sicurezza del runner.";
const STALE_INTERNAL_SHOPIFY_IMPORT_JOB_ERROR_CODE =
  "SYNCBAY_INTERNAL_IMPORT_STALE";
const STALE_INTERNAL_SHOPIFY_IMPORT_JOB_ERROR_MESSAGE =
  "Traccia interna import Shopify rimasta RUNNING oltre la finestra di sicurezza del runner.";

export async function runDueSyncJobs(
  input: {
    limit?: number;
    now?: Date;
  } = {},
) {
  const now = input.now ?? new Date();
  const limit = normalizeRunDueLimit(input.limit);

  await enqueueIncrementalSyncJobs(now);
  await recoverStaleRunningSyncJobsForDueShops({ limit, now });
  const cleanedInternalImportJobCount =
    await markStaleInternalShopifyImportJobsFailed({ limit, now });

  const jobs = await findDueSyncJobsByPriority({ limit, now });
  const results = new Array<DueSyncJobRunResult>(jobs.length);
  const runnableJobsByShop = new Map<string, DueSyncJobRunQueueItem[]>();

  for (const [index, job] of jobs.entries()) {
    const shopJobs = runnableJobsByShop.get(job.shopId) ?? [];
    shopJobs.push({ index, job });
    runnableJobsByShop.set(job.shopId, shopJobs);
  }

  await Promise.all(
    [...runnableJobsByShop.values()].map((shopJobs) =>
      runDueSyncJobGroup(shopJobs, results, now),
    ),
  );

  const completedResults = results.filter(
    (result): result is DueSyncJobRunResult => Boolean(result),
  );
  const archivedStaleFailedJobCount =
    await archiveSupersededFailedIncrementalSyncJobs({ now });

  return {
    archivedStaleFailedJobCount,
    failedCount: completedResults.filter((result) => result.status === "failed")
      .length,
    processedCount: completedResults.length,
    skippedCount: completedResults.filter(
      (result) => result.status === "skipped",
    ).length,
    cleanedInternalImportJobCount,
    succeededCount: completedResults.filter(
      (result) => result.status === "succeeded",
    ).length,
    results: completedResults,
  };
}

async function findDueSyncJobsByPriority(input: { limit: number; now: Date }) {
  const jobs: DueSyncJob[] = [];

  for (const type of getRunnableSyncJobTypes()) {
    const remainingLimit = input.limit - jobs.length;

    if (remainingLimit <= 0) break;

    const typedJobs = await prisma.syncJob.findMany({
      include: { shop: true },
      orderBy: [{ runAfter: "asc" }, { createdAt: "asc" }],
      take: remainingLimit,
      where: {
        ...getSchedulableSyncJobWhere(),
        runAfter: { lte: input.now },
        status: { in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING] },
        type,
      },
    });

    jobs.push(...typedJobs);
  }

  return jobs;
}

async function runDueSyncJobGroup(
  shopJobs: DueSyncJobRunQueueItem[],
  results: DueSyncJobRunResult[],
  now: Date,
) {
  const [nextJob, ...remainingJobs] = shopJobs;

  if (!nextJob) return;

  const claimedJob = await claimDueSyncJob(nextJob.job, now);

  if (!claimedJob) {
    results[nextJob.index] = {
      jobId: nextJob.job.id,
      status: "skipped" as const,
      type: nextJob.job.type,
    };

    return;
  }

  results[nextJob.index] = await runDueSyncJob(claimedJob);

  await runDueSyncJobGroup(remainingJobs, results, now);
}

async function claimDueSyncJob(job: DueSyncJob, now: Date) {
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
        shopId: job.shopId,
        status: { in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING] },
        ...getSchedulableSyncJobWhere(),
        type: { in: getRunnableSyncJobTypes() },
      },
    });

    if (claimed.count !== 1) return null;

    return tx.syncJob.findUniqueOrThrow({
      include: { shop: true },
      where: { id: job.id },
    });
  });
}

async function recoverStaleRunningSyncJobsForDueShops(input: {
  limit: number;
  now: Date;
}) {
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

async function markStaleInternalShopifyImportJobsFailed(input: {
  limit: number;
  now: Date;
}) {
  const staleCutoff = getRunningSyncJobStaleCutoff(input.now);
  const internalJobs = await prisma.syncJob.findMany({
    orderBy: [{ startedAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      idempotencyKey: true,
      shopId: true,
      startedAt: true,
      status: true,
    },
    take: input.limit,
    where: {
      idempotencyKey: { startsWith: "draft-import:" },
      OR: [{ startedAt: null }, { startedAt: { lte: staleCutoff } }],
      status: { in: [SyncJobStatus.RUNNING, SyncJobStatus.RETRYING] },
      type: SyncJobType.IMPORT_CATALOG,
    },
  });
  let cleanedCount = 0;

  for (const job of internalJobs) {
    if (
      !isStaleInternalShopifyImportJob({
        idempotencyKey: job.idempotencyKey,
        now: input.now,
        staleAfterMs: RUNNING_SYNC_JOB_STALE_AFTER_MS,
        startedAt: job.startedAt,
        status: job.status,
      })
    ) {
      continue;
    }

    const result = {
      internalJobKind: "shopify_import",
      runnerErrorCode: STALE_INTERNAL_SHOPIFY_IMPORT_JOB_ERROR_CODE,
      runnerErrorMessage: STALE_INTERNAL_SHOPIFY_IMPORT_JOB_ERROR_MESSAGE,
      staleAfterSeconds: RUNNING_SYNC_JOB_STALE_AFTER_MS / 1000,
      staleStartedAt: job.startedAt?.toISOString() ?? null,
      willRetry: false,
    } satisfies Prisma.JsonObject;

    const cleaned = await prisma.$transaction(async (tx) => {
      const updated = await tx.syncJob.updateMany({
        data: {
          errorCode: STALE_INTERNAL_SHOPIFY_IMPORT_JOB_ERROR_CODE,
          errorMessage: STALE_INTERNAL_SHOPIFY_IMPORT_JOB_ERROR_MESSAGE,
          finishedAt: input.now,
          result,
          status: SyncJobStatus.FAILED,
        },
        where: {
          id: job.id,
          idempotencyKey: job.idempotencyKey,
          startedAt: job.startedAt,
          status: { in: [SyncJobStatus.RUNNING, SyncJobStatus.RETRYING] },
          type: SyncJobType.IMPORT_CATALOG,
        },
      });

      if (updated.count !== 1) return false;

      await tx.auditLog.create({
        data: {
          details: result,
          message: "Traccia interna import Shopify stantia chiusa dal runner.",
          shopId: job.shopId,
          type: AuditEventType.SYNC_JOB_FAILED,
        },
      });

      return true;
    });

    if (cleaned) cleanedCount += 1;
  }

  return cleanedCount;
}

async function archiveSupersededFailedIncrementalSyncJobs(input: { now: Date }) {
  const failedJobShops = await prisma.syncJob.findMany({
    distinct: ["shopId"],
    select: { shopId: true },
    where: {
      errorCode: { in: [...STALE_FAILED_INCREMENTAL_SYNC_ERROR_CODES] },
      status: SyncJobStatus.FAILED,
      type: SyncJobType.SYNC_INCREMENTAL,
    },
  });
  let archivedCount = 0;

  for (const { shopId } of failedJobShops) {
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
      latestSuccessfulIncrementalSync?.finishedAt ??
      latestSuccessfulIncrementalSync?.updatedAt;

    if (!latestSuccessAt) continue;

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

    if (archived.count === 0) continue;

    archivedCount += archived.count;
    await prisma.auditLog.create({
      data: {
        details: {
          archiveCutoff: archiveCutoff.toISOString(),
          archivedCount: archived.count,
          latestSuccessfulIncrementalSyncAt: latestSuccessAt.toISOString(),
          reason: "superseded_failed_incremental_sync",
        } satisfies Prisma.JsonObject,
        message:
          "Fallimenti incrementali storici archiviati dopo un sync riuscito più recente.",
        shopId,
        type: AuditEventType.CONNECTION_CHECK,
      },
    });
  }

  return archivedCount;
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

async function enqueueIncrementalSyncJobs(now: Date) {
  const shops = await prisma.shop.findMany({
    include: {
      ebayConnections: {
        where: {
          marketplaceId: DEFAULT_MARKETPLACE_ID,
          status: EbayConnectionStatus.CONNECTED,
        },
      },
    },
    where: {
      installationStatus: "INSTALLED",
      syncEnabled: true,
    },
  });

  for (const shop of shops) {
    if (shop.ebayConnections.length === 0) continue;

    const activeJob = await prisma.syncJob.findFirst({
      select: { id: true },
      where: {
        ...getSchedulableSyncJobWhere(),
        shopId: shop.id,
        status: {
          in: [
            SyncJobStatus.PENDING,
            SyncJobStatus.RETRYING,
            SyncJobStatus.RUNNING,
          ],
        },
        type: {
          in: getCatalogReconcileBlockingJobTypes({
            archiveInactiveListing: SyncJobType.ARCHIVE_INACTIVE_LISTING,
            importCatalog: SyncJobType.IMPORT_CATALOG,
            syncIncremental: SyncJobType.SYNC_INCREMENTAL,
          }),
        },
      },
    });

    if (activeJob) continue;

    const lastJob = await prisma.syncJob.findFirst({
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
      select: { createdAt: true, finishedAt: true, runAfter: true },
      where: {
        shopId: shop.id,
        type: SyncJobType.SYNC_INCREMENTAL,
      },
    });
    const nextRunAfter = getNextIncrementalEnqueueAt({
      latestJob: lastJob,
      now,
      syncTargetSeconds: shop.syncTargetSeconds,
    });

    if (nextRunAfter > now) continue;

    try {
      const connection = shop.ebayConnections[0];
      const { accessToken } = await getUsableEbayAccessToken(connection);
      const [latestSellerEventsSyncJob, latestFullReconcileJob] =
        await Promise.all([
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
      const latestFullReconcileAt = getJobCompletionTime(
        latestFullReconcileJob,
      );
      const latestFullReconcileWatermarkAt =
        getDateFromPayload(
          latestFullReconcileJob?.payload ?? null,
          "activeCatalogReadAt",
        ) ??
        latestFullReconcileJob?.createdAt ??
        latestFullReconcileAt;
      const fullReconcileDue = isFullCatalogReconcileDue({
        intervalSecondsValue:
          process.env.SYNCBAY_EBAY_FULL_RECONCILE_INTERVAL_SECONDS,
        latestFullReconcileAt,
        now,
      });
      const sellerEventsWindow = fullReconcileDue
        ? null
        : getSellerEventsDeltaWindow({
            latestSuccessfulSyncAt: getSellerEventsWatermarkAt({
              latestFullReconcileCompletedAt: latestFullReconcileAt,
              latestFullReconcileWatermarkAt,
              latestSellerEventsCompletedAt: getJobCompletionTime(
                latestSellerEventsSyncJob,
              ),
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
            cooldownSecondsValue:
              process.env.SYNCBAY_EBAY_TRADING_RATE_LIMIT_COOLDOWN_SECONDS,
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

  if (
    reconcilePlan.syncBatches.length === 0 &&
    reconcilePlan.inactiveEbayItemIds.length === 0
  ) {
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

  await prisma.syncJob.createMany({
    data: [...syncJobs, ...archiveJobs],
    skipDuplicates: true,
  });
}

async function enqueueCatalogImageRepairSyncJobs(input: {
  now: Date;
  shopId: string;
}) {
  const limit = getCatalogImageRepairLimit(
    process.env.SYNCBAY_CATALOG_IMAGE_REPAIR_LIMIT,
  );

  if (limit === 0) return 0;

  const mappings = await prisma.productMapping.findMany({
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    select: {
      conflicts: {
        select: { id: true },
        take: 1,
        where: { status: SyncConflictStatus.OPEN },
      },
      ebayItemId: true,
      shopifyProductGid: true,
      snapshots: {
        orderBy: { capturedAt: "desc" },
        select: { payload: true },
        take: CATALOG_IMAGE_REPAIR_SNAPSHOT_LOOKBACK,
      },
    },
    take: CATALOG_RECONCILE_MAX_PRODUCTS,
    where: {
      marketplaceId: DEFAULT_MARKETPLACE_ID,
      shopId: input.shopId,
      shopifyProductGid: { not: null },
      status: ProductMappingStatus.ACTIVE,
    },
  });
  const ebayItemIds = getCatalogImageRepairItemIds({
    limit,
    mappings: mappings.map((mapping) => ({
      ebayItemId: mapping.ebayItemId,
      hasOpenConflicts: mapping.conflicts.length > 0,
      hasSnapshotThumbnailUrl: Boolean(
        getProductSnapshotThumbnailUrlFromPayloads(
          mapping.snapshots.map((snapshot) => snapshot.payload),
        ),
      ),
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

    if (imageRepairJobCount > 0) return;

    await createIncrementalNoopMarker({
      now: input.now,
      payload: {
        eventReadCount: delta.readCount,
        marketplaceId: DEFAULT_MARKETPLACE_ID,
        modTimeFrom: delta.timeFrom,
        modTimeTo: delta.timeTo,
        source: "seller_events_delta",
        watermarkAdvanced: true,
      },
      result: {
        eventReadCount: delta.readCount,
        noWork: true,
        source: "seller_events_delta",
        watermarkAdvanced: true,
      },
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

function getJobCompletionTime(
  job: { createdAt: Date; finishedAt: Date | null } | null,
) {
  return job ? (job.finishedAt ?? job.createdAt) : null;
}

function chunkArray<T>(items: T[], size: number) {
  if (size <= 0) return [items];

  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
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

async function recoverStaleRunningSyncJobs(
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

  for (const staleJob of staleJobs) {
    const nextAttempts = staleJob.attempts + 1;
    const retryAt =
      nextAttempts < staleJob.maxAttempts ? staleJob.runAfter : null;
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

    await tx.auditLog.create({
      data: {
        details: result,
        message: retryAt
          ? "Job SyncBay RUNNING stantio recuperato; retry pianificato dal runner."
          : "Job SyncBay RUNNING stantio segnato come fallito dal runner.",
        shopId: input.shopId,
        type: AuditEventType.SYNC_JOB_FAILED,
      },
    });

    recoveredCount += 1;
  }

  return recoveredCount;
}

function getRunningSyncJobStaleCutoff(now: Date) {
  return new Date(now.getTime() - RUNNING_SYNC_JOB_STALE_AFTER_MS);
}

function getStaleRunningSyncJobWhere(
  staleCutoff: Date,
  shopId?: string,
): Prisma.SyncJobWhereInput {
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

function getSchedulableSyncJobWhere(): Prisma.SyncJobWhereInput {
  return {
    OR: [
      { idempotencyKey: null },
      {
        NOT: {
          idempotencyKey: {
            startsWith: "draft-import:",
          },
        },
      },
    ],
  };
}

async function runDueSyncJob(job: DueSyncJob) {
  try {
    if (job.type === SyncJobType.IMPORT_CATALOG) {
      return await runImportCatalogJob(job);
    }
    if (job.type === SyncJobType.SYNC_INCREMENTAL) {
      return await runIncrementalSyncJob(job);
    }
    if (job.type === SyncJobType.UPDATE_EBAY_STOCK) {
      return await runUpdateEbayStockJob(job);
    }
    if (job.type === SyncJobType.ARCHIVE_INACTIVE_LISTING) {
      return await runMarkInactiveListingSoldOutJob(job);
    }
    if (job.type === SyncJobType.DETECT_SHOPIFY_CHANGES) {
      return await runDetectShopifyChangesJob(job);
    }

    return {
      jobId: job.id,
      status: "skipped" as const,
      type: job.type,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    const tradingRateLimitRetryAt = isEbayTradingUsageLimitError(errorMessage)
      ? getNextEbayTradingRateLimitRetryAt({
          cooldownSecondsValue:
            process.env.SYNCBAY_EBAY_TRADING_RATE_LIMIT_COOLDOWN_SECONDS,
          now: new Date(),
        })
      : null;

    await markJobFailedOrRetrying({
      errorCode: tradingRateLimitRetryAt
        ? "EBAY_TRADING_RATE_LIMITED"
        : "SYNCBAY_JOB_RUNNER_FAILED",
      errorMessage,
      job,
      result:
        tradingRateLimitRetryAt === null
          ? undefined
          : {
              rateLimitCooldownSeconds: Math.ceil(
                (tradingRateLimitRetryAt.getTime() - Date.now()) / 1000,
              ),
            },
      retryAtOverride: tradingRateLimitRetryAt,
    });

    return {
      errorMessage,
      jobId: job.id,
      status: "failed" as const,
      type: job.type,
    };
  }
}

async function runImportCatalogJob(job: DueSyncJob) {
  const ebayItemIds = getEbayItemIds(job.payload);

  if (ebayItemIds.length === 0) {
    throw new Error("Job import senza eBay ItemID da riprendere.");
  }

  const splitResult = await splitOversizedEbayItemJobIfNeeded(job, ebayItemIds);

  if (splitResult !== "not_needed") {
    return {
      jobId: job.id,
      status: "succeeded" as const,
      type: job.type,
    };
  }

  const connection = await prisma.ebayConnection.findUnique({
    where: {
      shopId_marketplaceId: {
        marketplaceId: getEbayMarketplaceId(job.payload),
        shopId: job.shopId,
      },
    },
  });

  if (!connection || connection.status !== EbayConnectionStatus.CONNECTED) {
    throw new Error("Connessione eBay non collegata per il job import.");
  }

  const [admin, previewResult] = await Promise.all([
    getShopifyAdminGraphqlClient(job.shop.shopDomain),
    getImportPreviewResultByItemIds(connection, ebayItemIds),
  ]);
  const filteredPreviewResult = filterPreviewResultByItemIds(
    previewResult,
    ebayItemIds,
  );
  const foundItemIds = new Set(
    filteredPreviewResult.items.map((item) => item.itemId),
  );
  const missingItemIds = ebayItemIds.filter(
    (itemId) => !foundItemIds.has(itemId),
  );

  if (missingItemIds.length > 0) {
    throw new Error(
      `${missingItemIds.length} listing eBay del job non sono più recuperabili via ItemID.`,
    );
  }

  const result = await createShopifyDraftProductsIfEnabled({
    admin,
    catalogImportRunId: getCatalogImportRunId(job.payload),
    defaultLocationGid: job.shop.defaultLocationGid,
    hasDefaultLocation: Boolean(job.shop.defaultLocationGid),
    importProductStatusOverride: getImportProductStatus(job.payload),
    previewResult: filteredPreviewResult,
    shopDomain: job.shop.shopDomain,
  });

  if (result.status === "blocked") {
    await markJobFailedOrRetrying({
      errorCode: "SYNCBAY_JOB_BLOCKED",
      errorMessage: result.readiness.blockers.join(", "),
      job,
    });

    return {
      errorMessage: result.readiness.blockers.join(", "),
      jobId: job.id,
      status: "failed" as const,
      type: job.type,
    };
  }

  if (result.status === "failed") {
    await markJobFailedOrRetrying({
      errorCode: "SHOPIFY_DRAFT_IMPORT_FAILED",
      errorMessage:
        result.errorMessage ?? "Import Shopify non completato dal runner.",
      job,
    });

    return {
      errorMessage:
        result.errorMessage ?? "Import Shopify non completato dal runner.",
      jobId: job.id,
      status: "failed" as const,
      type: job.type,
    };
  }

  await markJobSucceeded({
    delegatedJobId: result.jobId,
    job,
    warnings: result.warnings ?? [],
  });

  return {
    jobId: job.id,
    status: "succeeded" as const,
    type: job.type,
  };
}

async function runIncrementalSyncJob(job: DueSyncJob) {
  const ebayItemIds = getEbayItemIds(job.payload);

  if (ebayItemIds.length === 0) {
    throw new Error("Job sync incrementale senza eBay ItemID.");
  }

  const splitResult = await splitOversizedEbayItemJobIfNeeded(job, ebayItemIds);

  if (splitResult !== "not_needed") {
    return {
      jobId: job.id,
      status: "succeeded" as const,
      type: job.type,
    };
  }

  const openConflicts = await prisma.syncConflict.findMany({
    select: {
      field: true,
      id: true,
      mappingId: true,
      mapping: {
        select: {
          ebayItemId: true,
          id: true,
          shopifyProductGid: true,
          status: true,
        },
      },
    },
    where: {
      mapping: { ebayItemId: { in: ebayItemIds } },
      shopId: job.shopId,
      status: SyncConflictStatus.OPEN,
    },
  });
  const reactivationConflictMappingIds = [
    ...new Set(
      openConflicts.flatMap((conflict) => {
        if (
          !shouldResolveOpenConflictsForInactiveMappingStatus(
            conflict.mapping?.status ?? null,
          )
        ) {
          return [];
        }

        return conflict.mapping?.id ? [conflict.mapping.id] : [];
      }),
    ),
  ];
  const reactivationConflictResolvedCount =
    reactivationConflictMappingIds.length > 0
      ? (
          await prisma.syncConflict.updateMany({
            data: {
              resolvedAt: new Date(),
              status: SyncConflictStatus.RESOLVED,
            },
            where: {
              mappingId: { in: reactivationConflictMappingIds },
              shopId: job.shopId,
              status: SyncConflictStatus.OPEN,
            },
          })
        ).count
      : 0;
  const alignedDescriptionConflicts =
    await resolveLiveAlignedDescriptionConflicts({
      conflicts: openConflicts,
      defaultLocationGid: job.shop.defaultLocationGid,
      shopId: job.shopId,
      shopDomain: job.shop.shopDomain,
    });
  const resolvedAlignedDescriptionConflictIds = new Set(
    alignedDescriptionConflicts.conflictIds,
  );
  const openConflictItemIds = new Set(
    openConflicts.flatMap((conflict) => {
      if (resolvedAlignedDescriptionConflictIds.has(conflict.id)) {
        return [];
      }
      if (
        !shouldBlockIncrementalSyncForOpenConflictMappingStatus(
          conflict.mapping?.status ?? null,
        )
      ) {
        return [];
      }

      return conflict.mapping?.ebayItemId ? [conflict.mapping.ebayItemId] : [];
    }),
  );
  const syncableItemIds = ebayItemIds.filter(
    (itemId) => !openConflictItemIds.has(itemId),
  );

  if (syncableItemIds.length === 0) {
    await markJobSucceeded({
      delegatedJobId: null,
      job,
      result: {
        alignedDescriptionConflictResolvedCount:
          alignedDescriptionConflicts.count,
        conflictSkippedCount: ebayItemIds.length,
        reactivationConflictResolvedCount,
        requestedCount: ebayItemIds.length,
        syncedCount: 0,
      },
      warnings: [
        "Sync incrementale saltato: tutti i prodotti del batch hanno conflitti Shopify aperti.",
      ],
    });

    return {
      jobId: job.id,
      status: "succeeded" as const,
      type: job.type,
    };
  }

  const [admin, previewResult] = await Promise.all([
    getShopifyAdminGraphqlClient(job.shop.shopDomain),
    getIncrementalPreviewResult(job, syncableItemIds),
  ]);
  const filteredPreviewResult = filterPreviewResultByItemIds(
    previewResult,
    syncableItemIds,
  );
  const result = await createShopifyDraftProductsIfEnabled({
    admin,
    defaultLocationGid: job.shop.defaultLocationGid,
    hasDefaultLocation: Boolean(job.shop.defaultLocationGid),
    importProductStatusOverride: getImportProductStatus(job.payload),
    previewResult: filteredPreviewResult,
    shopDomain: job.shop.shopDomain,
  });

  if (result.status === "blocked" || result.status === "failed") {
    await markJobFailedOrRetrying({
      errorCode:
        result.status === "blocked"
          ? "SYNCBAY_INCREMENTAL_BLOCKED"
          : "SYNCBAY_INCREMENTAL_FAILED",
      errorMessage:
        result.status === "blocked"
          ? result.readiness.blockers.join(", ")
          : (result.errorMessage ?? "Sync incrementale non completato."),
      job,
    });

    return {
      errorMessage:
        result.status === "blocked"
          ? result.readiness.blockers.join(", ")
          : (result.errorMessage ?? "Sync incrementale non completato."),
      jobId: job.id,
      status: "failed" as const,
      type: job.type,
    };
  }

  await markJobSucceeded({
    delegatedJobId: result.jobId,
    job,
    result: {
      alignedDescriptionConflictResolvedCount:
        alignedDescriptionConflicts.count,
      conflictSkippedCount: openConflictItemIds.size,
      reactivationConflictResolvedCount,
      requestedCount: ebayItemIds.length,
      syncedCount: syncableItemIds.length,
    },
    warnings: result.warnings ?? [],
  });
  await maybeMarkSellerEventsRunWatermarkSucceeded(job);

  return {
    jobId: job.id,
    status: "succeeded" as const,
    type: job.type,
  };
}

async function runUpdateEbayStockJob(job: DueSyncJob) {
  const lineItems = getOrderLineItems(job.payload);

  if (lineItems.length === 0) {
    throw new Error("Job stock eBay senza righe ordine Shopify.");
  }

  const connection = await getConnectedEbayConnection(job);
  const stockDryRun = isEbayStockDryRunEnabled(
    process.env.SYNCBAY_EBAY_STOCK_DRY_RUN,
  );
  let accessToken: string | null = null;
  const planned: Prisma.JsonObject[] = [];
  const updated: Prisma.JsonObject[] = [];
  const skipped: Prisma.JsonObject[] = [];
  const orderCurrencyValidation = validateEbayStockOrderCurrency({
    marketplaceId: connection.marketplaceId,
    orderCurrency: getOrderCurrency(job.payload),
  });

  if (!orderCurrencyValidation.ok) {
    await markJobSucceeded({
      delegatedJobId: null,
      job,
      result: {
        dryRun: stockDryRun,
        planned,
        plannedCount: planned.length,
        skipped: lineItems.map((lineItem) => ({
          expectedCurrency: orderCurrencyValidation.expectedCurrency,
          lineItemKey: lineItem.lineItemKey,
          orderCurrency: orderCurrencyValidation.orderCurrency,
          quantity: lineItem.quantity,
          reason: orderCurrencyValidation.reason,
        })),
        skippedCount: lineItems.length,
        updated,
        updatedCount: updated.length,
      },
      warnings: ["Ordine Shopify saltato: valuta non coerente con eBay.it."],
    });

    return {
      jobId: job.id,
      status: "succeeded" as const,
      type: job.type,
    };
  }

  for (const lineItem of lineItems) {
    const mapping = await findProductMappingForOrderLine(job.shopId, lineItem);

    if (!mapping) {
      skipped.push({
        lineItemKey: lineItem.lineItemKey,
        quantity: lineItem.quantity,
        reason: "mapping_not_found",
        shopifyProductGid: lineItem.shopifyProductGid ?? null,
        shopifyVariantGid: lineItem.shopifyVariantGid ?? null,
      });
      continue;
    }

    const lineDryRun = shouldDryRunEbayStockLine({
      allowlist: process.env.SYNCBAY_EBAY_STOCK_REAL_WRITE_ALLOWLIST,
      ebayItemId: mapping.ebayItemId,
      shopDomain: job.shop.shopDomain,
      shopifyVariantGid: mapping.shopifyVariantGid,
      stockDryRunEnabled: stockDryRun,
    });

    if (
      await hasCompletedStockUpdateForLine({
        ebayItemId: mapping.ebayItemId,
        includeDryRunPlans: lineDryRun,
        job,
        lineItem,
        mappingId: mapping.id,
      })
    ) {
      skipped.push({
        ebayItemId: mapping.ebayItemId,
        lineItemKey: lineItem.lineItemKey,
        quantity: lineItem.quantity,
        reason: "already_processed",
      });
      continue;
    }

    const latestSnapshot = await prisma.productSnapshot.findFirst({
      orderBy: { capturedAt: "desc" },
      where: {
        mappingId: mapping.id,
      },
    });
    const latestSkuPolicySnapshot = await prisma.productSnapshot.findFirst({
      orderBy: { capturedAt: "desc" },
      where: {
        mappingId: mapping.id,
        payload: {
          path: ["skuGenerated"],
          not: Prisma.JsonNull,
        },
      },
    });
    const currencyValidation = validateEbayStockCurrency({
      marketplaceId: mapping.marketplaceId,
      snapshotCurrency: latestSnapshot?.currency ?? null,
    });

    if (!currencyValidation.ok) {
      skipped.push({
        ebayItemId: mapping.ebayItemId,
        expectedCurrency: currencyValidation.expectedCurrency,
        lineItemKey: lineItem.lineItemKey,
        quantity: lineItem.quantity,
        reason: currencyValidation.reason,
        snapshotCurrency: currencyValidation.snapshotCurrency,
      });
      continue;
    }

    const previousQuantity = latestSnapshot?.quantity ?? 0;
    const nextQuantity = Math.max(0, previousQuantity - lineItem.quantity);

    if (lineDryRun) {
      planned.push({
        currency: currencyValidation.snapshotCurrency,
        dryRun: true,
        ebayItemId: mapping.ebayItemId,
        lineItemKey: lineItem.lineItemKey,
        nextQuantity,
        orderedQuantity: lineItem.quantity,
        previousQuantity,
        reason: "stock_dry_run_enabled",
      });
      continue;
    }

    accessToken ??= (await getUsableEbayAccessToken(connection)).accessToken;

    if (!accessToken) {
      throw new Error("Token eBay non disponibile per aggiornare lo stock.");
    }

    await reviseEbayTradingInventoryQuantity({
      accessToken,
      connection,
      itemId: mapping.ebayItemId,
      quantity: nextQuantity,
      sku: mapping.sku,
      skuGenerated: getSnapshotSkuGenerated(latestSkuPolicySnapshot?.payload),
    });
    await prisma.productSnapshot.create({
      data: {
        ebayItemId: mapping.ebayItemId,
        mappingId: mapping.id,
        payload: {
          previousQuantity,
          orderLineItemKey: lineItem.lineItemKey,
          reason: "shopify_order_paid",
          syncJobId: job.id,
          updatedEbayFromShopifyOrder: true,
        } satisfies Prisma.JsonObject,
        currency: currencyValidation.snapshotCurrency,
        priceAmount: latestSnapshot?.priceAmount ?? null,
        productStatus: latestSnapshot?.productStatus ?? null,
        quantity: nextQuantity,
        shopId: job.shopId,
        shopifyProductGid: mapping.shopifyProductGid,
        shopifyVariantGid: mapping.shopifyVariantGid,
        sku: mapping.sku,
        source: ProductSnapshotSource.SYNCBAY,
        title: latestSnapshot?.title ?? null,
      },
    });
    updated.push({
      currency: currencyValidation.snapshotCurrency,
      ebayItemId: mapping.ebayItemId,
      lineItemKey: lineItem.lineItemKey,
      nextQuantity,
      orderedQuantity: lineItem.quantity,
      previousQuantity,
      reason: stockDryRun
        ? "stock_real_write_allowlisted"
        : "stock_dry_run_disabled",
    });
  }

  await markJobSucceeded({
    delegatedJobId: null,
    job,
    result: {
      dryRun: stockDryRun,
      planned,
      plannedCount: planned.length,
      realWriteAllowlistEnabled: Boolean(
        process.env.SYNCBAY_EBAY_STOCK_REAL_WRITE_ALLOWLIST?.trim(),
      ),
      skipped,
      skippedCount: skipped.length,
      updated,
      updatedCount: updated.length,
    },
    warnings:
      skipped.length > 0
        ? ["Alcune righe ordine non sono state applicate a eBay."]
        : [],
  });

  return {
    jobId: job.id,
    status: "succeeded" as const,
    type: job.type,
  };
}

// Job storicamente chiamato ARCHIVE_INACTIVE_LISTING: il listing eBay inattivo
// non viene più archiviato ma mantenuto su Shopify come esaurito (scorta 0,
// politica DENY, tag esaurito, mapping OUT_OF_STOCK). Vedi ADR 0011.
async function runMarkInactiveListingSoldOutJob(job: DueSyncJob) {
  const ebayItemId = getArchiveEbayItemId(job.payload);

  if (!ebayItemId) {
    throw new Error("Job esaurito listing inattivo senza eBay ItemID.");
  }

  const marketplaceId = getEbayMarketplaceId(job.payload);
  const mapping = await prisma.productMapping.findFirst({
    where: {
      ebayItemId,
      marketplaceId,
      shopId: job.shopId,
      status: ProductMappingStatus.ACTIVE,
    },
  });

  if (!mapping) {
    await markJobSucceeded({
      delegatedJobId: null,
      job,
      result: {
        ebayItemId,
        skippedReason: "active_mapping_not_found",
        soldOutCount: 0,
      },
      warnings: ["Esaurito saltato: mapping attivo non trovato."],
    });
    await maybeMarkSellerEventsRunWatermarkSucceeded(job);

    return {
      jobId: job.id,
      status: "succeeded" as const,
      type: job.type,
    };
  }

  const soldOutWarnings: string[] = [];

  if (mapping.shopifyProductGid) {
    const admin = await getShopifyAdminGraphqlClient(job.shop.shopDomain);
    const soldOutResult = await markShopifyProductSoldOut(admin, {
      jobId: job.id,
      locationGid: job.shop.defaultLocationGid,
      productGid: mapping.shopifyProductGid,
      variantGid: mapping.shopifyVariantGid,
    });
    soldOutWarnings.push(...soldOutResult.warnings);
  }

  const now = new Date();

  const [, , resolvedConflicts] = await prisma.$transaction([
    prisma.productMapping.update({
      data: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncedAt: now,
        status: ProductMappingStatus.OUT_OF_STOCK,
      },
      where: { id: mapping.id },
    }),
    prisma.productSnapshot.create({
      data: {
        ebayItemId: mapping.ebayItemId,
        mappingId: mapping.id,
        payload: {
          reason: "ebay_listing_inactive",
          soldOutShopifyProduct: Boolean(mapping.shopifyProductGid),
          syncJobId: job.id,
        } satisfies Prisma.JsonObject,
        // Il prodotto Shopify resta ACTIVE: è solo esaurito (scorta 0).
        productStatus: "ACTIVE",
        quantity: 0,
        shopId: job.shopId,
        shopifyProductGid: mapping.shopifyProductGid,
        shopifyVariantGid: mapping.shopifyVariantGid,
        sku: mapping.sku,
        source: ProductSnapshotSource.SYNCBAY,
      },
    }),
    resolveOpenConflictsForInactiveMappingMutation({
      mappingId: mapping.id,
      resolvedAt: now,
      shopId: job.shopId,
    }),
  ]);

  await markJobSucceeded({
    delegatedJobId: null,
    job,
    result: {
      ebayItemId,
      resolvedConflictCount: resolvedConflicts.count,
      shopifyProductGid: mapping.shopifyProductGid,
      soldOutCount: 1,
      soldOutShopifyProduct: Boolean(mapping.shopifyProductGid),
    },
    warnings: mapping.shopifyProductGid
      ? soldOutWarnings
      : ["Mapping messo in esaurito senza prodotto Shopify collegato."],
  });
  await maybeMarkSellerEventsRunWatermarkSucceeded(job);

  return {
    jobId: job.id,
    status: "succeeded" as const,
    type: job.type,
  };
}

async function maybeMarkSellerEventsRunWatermarkSucceeded(job: DueSyncJob) {
  const source = getStringFromPayload(job.payload, "source");
  const runId = getStringFromPayload(job.payload, "runId");
  const marketplaceId = getEbayMarketplaceId(job.payload);
  const modTimeFrom = getStringFromPayload(job.payload, "modTimeFrom");
  const modTimeTo = getStringFromPayload(job.payload, "modTimeTo");

  if (source !== "seller_events_delta" || !runId || !modTimeTo) return;

  const runJobs = await prisma.syncJob.findMany({
    select: { status: true },
    where: {
      AND: [
        { payload: { path: ["source"], equals: "seller_events_delta" } },
        { payload: { path: ["runId"], equals: runId } },
      ],
      shopId: job.shopId,
      type: {
        in: [
          SyncJobType.SYNC_INCREMENTAL,
          SyncJobType.ARCHIVE_INACTIVE_LISTING,
        ],
      },
    },
  });

  if (
    !shouldAdvanceSellerEventsRunWatermark({
      statuses: runJobs.map((runJob) => runJob.status),
    })
  ) {
    return;
  }

  const finishedAt = new Date();
  const processedJobCount = runJobs.length;

  await prisma.syncJob.createMany({
    data: [
      {
        attempts: 1,
        finishedAt,
        idempotencyKey: `seller-events-watermark:${job.shopId}:${marketplaceId}:${runId}`,
        maxAttempts: 1,
        payload: {
          marketplaceId,
          modTimeFrom,
          modTimeTo,
          processedJobCount,
          runId,
          source: "seller_events_delta",
          watermarkAdvanced: true,
        } satisfies Prisma.JsonObject,
        result: {
          processedJobCount,
          source: "seller_events_delta",
          watermarkAdvanced: true,
        } satisfies Prisma.JsonObject,
        runAfter: finishedAt,
        shopId: job.shopId,
        status: SyncJobStatus.SUCCEEDED,
        type: SyncJobType.SYNC_INCREMENTAL,
      },
    ],
    skipDuplicates: true,
  });
}

function getSnapshotSkuGenerated(payload: Prisma.JsonValue | null | undefined) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const value = payload.skuGenerated;

  return typeof value === "boolean" ? value : null;
}

async function runDetectShopifyChangesJob(job: DueSyncJob) {
  const productGid = getStringFromPayload(job.payload, "resourceId");
  const inventoryItemGid = getStringFromPayload(
    job.payload,
    "inventoryItemGid",
  );
  const mapping = productGid
    ? await prisma.productMapping.findFirst({
        where: { shopId: job.shopId, shopifyProductGid: productGid },
      })
    : inventoryItemGid
      ? await findMappingByInventoryItemGid(job.shopId, inventoryItemGid)
      : null;

  if (!mapping?.shopifyProductGid) {
    await markJobSucceeded({
      delegatedJobId: null,
      job,
      result: { conflictCount: 0, skippedReason: "mapping_not_found" },
      warnings: ["Webhook Shopify senza mapping SyncBay collegato."],
    });

    return {
      jobId: job.id,
      status: "succeeded" as const,
      type: job.type,
    };
  }

  if (!shouldDetectShopifyConflictsForMappingStatus(mapping.status)) {
    const resolvedConflictCount =
      shouldResolveOpenConflictsForInactiveMappingStatus(mapping.status)
        ? await resolveOpenConflictsForInactiveMapping({
            mappingId: mapping.id,
            shopId: job.shopId,
          })
        : 0;

    await markJobSucceeded({
      delegatedJobId: null,
      job,
      result: {
        conflictCount: 0,
        mappingStatus: mapping.status,
        resolvedConflictCount,
        skippedReason: "mapping_not_active",
      },
      warnings: [],
    });

    return {
      jobId: job.id,
      status: "succeeded" as const,
      type: job.type,
    };
  }

  const admin = await getShopifyAdminGraphqlClient(job.shop.shopDomain);
  const [product, snapshot] = await Promise.all([
    getShopifyProductForConflict(
      admin,
      mapping.shopifyProductGid,
      job.shop.defaultLocationGid,
    ),
    getLatestSyncBayConflictBaseline(mapping.id),
  ]);

  if (!product || !snapshot) {
    await markJobSucceeded({
      delegatedJobId: null,
      job,
      result: {
        conflictCount: 0,
        skippedReason: "missing_product_or_snapshot",
      },
      warnings: ["Confronto Shopify saltato: prodotto o snapshot assente."],
    });

    return {
      jobId: job.id,
      status: "succeeded" as const,
      type: job.type,
    };
  }

  const conflicts = getDetectedShopifyConflicts(
    product,
    snapshot,
    Boolean(job.shop.defaultLocationGid),
  );

  for (const conflict of conflicts) {
    await upsertOpenConflict({
      ...conflict,
      mappingId: mapping.id,
      shopId: job.shopId,
    });
  }
  const resolvedConflictCount = await resolveAlignedOpenConflicts({
    detectedConflictFields: conflicts.map((conflict) => conflict.field),
    mappingId: mapping.id,
    shopId: job.shopId,
  });

  await markJobSucceeded({
    delegatedJobId: null,
    job,
    result: {
      conflictCount: conflicts.length,
      fields: conflicts.map((conflict) => conflict.field),
      resolvedConflictCount,
    },
    warnings: [],
  });

  return {
    jobId: job.id,
    status: "succeeded" as const,
    type: job.type,
  };
}

async function getLatestSyncBayConflictBaseline(mappingId: string) {
  const [
    descriptionSnapshot,
    imageSnapshot,
    priceSnapshot,
    statusSnapshot,
    quantitySnapshot,
    titleSnapshot,
  ] = await Promise.all([
    findLatestSyncBayDescriptionBaseline(mappingId),
    findLatestSyncBaySnapshotWithField(mappingId, {
      imageCount: { not: null },
    }),
    findLatestSyncBaySnapshotWithField(mappingId, {
      priceAmount: { not: null },
    }),
    findLatestSyncBaySnapshotWithField(mappingId, {
      productStatus: { not: null },
    }),
    findLatestSyncBaySnapshotWithField(mappingId, { quantity: { not: null } }),
    findLatestSyncBaySnapshotWithField(mappingId, { title: { not: null } }),
  ]);

  if (
    !descriptionSnapshot &&
    !imageSnapshot &&
    !priceSnapshot &&
    !statusSnapshot &&
    !quantitySnapshot &&
    !titleSnapshot
  ) {
    return null;
  }

  return {
    descriptionHash: descriptionSnapshot?.descriptionHash ?? null,
    imageCount: imageSnapshot?.imageCount ?? null,
    priceAmount: priceSnapshot?.priceAmount ?? null,
    productStatus: statusSnapshot?.productStatus ?? null,
    quantity: quantitySnapshot?.quantity ?? null,
    title: titleSnapshot?.title ?? null,
  };
}

async function findLatestSyncBaySnapshotWithField(
  mappingId: string,
  fieldWhere: Prisma.ProductSnapshotWhereInput,
) {
  return prisma.productSnapshot.findFirst({
    orderBy: { capturedAt: "desc" },
    where: {
      mappingId,
      source: ProductSnapshotSource.SYNCBAY,
      ...fieldWhere,
    },
  });
}

async function findLatestSyncBayDescriptionBaseline(mappingId: string) {
  const candidates = await prisma.productSnapshot.findMany({
    orderBy: { capturedAt: "desc" },
    where: getLatestSyncBayDescriptionBaselineWhere(mappingId),
  });

  return (
    candidates.find((snapshot) =>
      shouldUseSyncBayDescriptionBaselinePayload(snapshot.payload),
    ) ?? null
  );
}

async function getImportPreviewResultByItemIds(
  connection: EbayConnection,
  ebayItemIds: string[],
) {
  const { accessToken } = await getUsableEbayAccessToken(connection);
  const candidates = await getEbayTradingCandidatesByItemIds({
    accessToken,
    connection,
    itemIds: ebayItemIds,
  });

  return buildImportPreview(candidates, "live");
}

async function getIncrementalPreviewResult(
  job: DueSyncJob,
  ebayItemIds: string[],
) {
  const payloadCandidates = getPreviewCandidates(job.payload);

  if (payloadCandidates.length > 0) {
    return buildImportPreview(payloadCandidates, "live");
  }

  const connection = await getConnectedEbayConnection(job);

  return getImportPreviewResultByItemIds(connection, ebayItemIds);
}

function getPreviewCandidates(payload: Prisma.JsonValue | null) {
  const object = getJsonObject(payload);
  const candidates = object?.previewCandidates;

  return Array.isArray(candidates)
    ? candidates.flatMap((candidate) => {
        const normalized = getPreviewCandidate(candidate);
        return normalized ? [normalized] : [];
      })
    : [];
}

function getPreviewCandidate(
  value: unknown,
): ImportPreviewListingCandidate | null {
  return deserializeIncrementalPreviewCandidate(value);
}

async function markJobFailedOrRetrying(input: {
  errorCode: string;
  errorMessage: string;
  job: DueSyncJob;
  result?: Prisma.JsonObject;
  retryAtOverride?: Date | null;
}) {
  const nextAttempts = input.job.attempts + 1;
  const retryAt =
    input.retryAtOverride ??
    (nextAttempts < input.job.maxAttempts ? getRetryAfter(nextAttempts) : null);
  const result = {
    ...(input.result ?? {}),
    runnerErrorCode: input.errorCode,
    runnerErrorMessage: input.errorMessage,
    retryScheduledAt: retryAt?.toISOString() ?? null,
    willRetry: Boolean(retryAt),
  } satisfies Prisma.JsonObject;

  await prisma.$transaction(async (tx) => {
    const updated = await tx.syncJob.updateMany({
      data: {
        attempts: { increment: 1 },
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        finishedAt: new Date(),
        result,
        runAfter: retryAt ?? undefined,
        status: retryAt ? SyncJobStatus.RETRYING : SyncJobStatus.FAILED,
      },
      where: { id: input.job.id, status: SyncJobStatus.RUNNING },
    });

    if (updated.count !== 1) return;

    await tx.auditLog.create({
      data: {
        details: result,
        message: retryAt
          ? "Job SyncBay non completato; retry pianificato dal runner."
          : "Job SyncBay non completato dal runner.",
        shopId: input.job.shopId,
        type: AuditEventType.SYNC_JOB_FAILED,
      },
    });
  });
}

async function markJobSucceeded(input: {
  delegatedJobId: string | null;
  job: DueSyncJob;
  result?: Prisma.JsonObject;
  warnings: string[];
}) {
  const result = {
    ...(input.result ?? {}),
    delegatedJobId: input.delegatedJobId,
    warnings: [...new Set(input.warnings)],
  } satisfies Prisma.JsonObject;

  await prisma.$transaction(async (tx) => {
    const updated = await tx.syncJob.updateMany({
      data: {
        errorCode: null,
        errorMessage: null,
        finishedAt: new Date(),
        result,
        status: SyncJobStatus.SUCCEEDED,
      },
      where: { id: input.job.id, status: SyncJobStatus.RUNNING },
    });

    if (updated.count !== 1) return;

    await tx.auditLog.create({
      data: {
        details: result,
        message: "Job SyncBay completato dal runner.",
        shopId: input.job.shopId,
        type: AuditEventType.SYNC_JOB_SUCCEEDED,
      },
    });
  });
}

async function splitOversizedEbayItemJobIfNeeded(
  job: DueSyncJob,
  ebayItemIds: string[],
) {
  if (ebayItemIds.length <= RUNNER_EBAY_ITEM_BATCH_SIZE) return "not_needed";

  const payload = getJsonObject(job.payload);

  if (!payload) return "not_needed";

  const splitPayloads = buildEbayItemJobSplitPayloads({
    ebayItemIds,
    maxItems: RUNNER_EBAY_ITEM_BATCH_SIZE,
    parentJobId: job.id,
    payload,
  });
  const now = new Date();
  const result = {
    requestedCount: ebayItemIds.length,
    splitBatchSize: RUNNER_EBAY_ITEM_BATCH_SIZE,
    splitJobCount: splitPayloads.length,
  } satisfies Prisma.JsonObject;

  const split = await prisma.$transaction(async (tx) => {
    const updated = await tx.syncJob.updateMany({
      data: {
        errorCode: null,
        errorMessage: null,
        finishedAt: now,
        result,
        status: SyncJobStatus.SUCCEEDED,
      },
      where: { id: job.id, status: SyncJobStatus.RUNNING },
    });

    if (updated.count !== 1) return "not_running";

    await tx.syncJob.createMany({
      data: splitPayloads.map((splitPayload, index) => ({
        attempts: 0,
        idempotencyKey: buildEbayItemJobSplitIdempotencyKey({
          parentJobId: job.id,
          payload,
          splitIndex: index + 1,
        }),
        maxAttempts: job.maxAttempts,
        payload: splitPayload as Prisma.JsonObject,
        runAfter: now,
        shopId: job.shopId,
        status: SyncJobStatus.PENDING,
        type: job.type,
      })),
      skipDuplicates: true,
    });

    await tx.auditLog.create({
      data: {
        details: result,
        message:
          "Job SyncBay spezzato in batch più piccoli per il runner automatico.",
        shopId: job.shopId,
        type: AuditEventType.SYNC_JOB_SUCCEEDED,
      },
    });

    return "split";
  });

  return split;
}

function filterPreviewResultByItemIds(
  previewResult: ImportPreviewResult,
  ebayItemIds: string[],
): ImportPreviewResult {
  const itemsById = new Map(
    previewResult.items.map((item) => [item.itemId, item]),
  );
  const items = ebayItemIds.flatMap((itemId) => {
    const item = itemsById.get(itemId);

    return item ? [item] : [];
  });

  return {
    ...previewResult,
    items,
    summary: summarizePreviewItems(items),
  };
}

function summarizePreviewItems(
  items: ImportPreviewItem[],
): ImportPreviewSummary {
  return {
    errorCount: items.filter((item) => item.status === "error").length,
    importableCount: items.filter((item) => item.status === "importable")
      .length,
    skippedCount: items.filter((item) => item.status === "skipped").length,
    totalCount: items.length,
    warningCount: items.reduce(
      (total, item) =>
        total +
        item.issues.filter((issue) => issue.severity === "warning").length,
      0,
    ),
  };
}

function getEbayItemIds(payload: Prisma.JsonValue | null) {
  const object = getJsonObject(payload);
  const ebayItemIds = object?.ebayItemIds;

  return Array.isArray(ebayItemIds)
    ? ebayItemIds.filter(
        (itemId): itemId is string => typeof itemId === "string",
      )
    : [];
}

function getArchiveEbayItemId(payload: Prisma.JsonValue | null) {
  const ebayItemId = getStringFromPayload(payload, "ebayItemId");

  if (ebayItemId?.trim()) return ebayItemId.trim();

  return getEbayItemIds(payload)[0] ?? null;
}

function getEbayMarketplaceId(payload: Prisma.JsonValue | null) {
  const object = getJsonObject(payload);
  const marketplaceId = object?.marketplaceId;

  return typeof marketplaceId === "string" && marketplaceId.trim()
    ? marketplaceId
    : DEFAULT_MARKETPLACE_ID;
}

function getImportProductStatus(payload: Prisma.JsonValue | null) {
  const object = getJsonObject(payload);
  const importProductStatus = object?.importProductStatus;

  return normalizeImportProductStatus(
    typeof importProductStatus === "string" ? importProductStatus : undefined,
  );
}

function getCatalogImportRunId(payload: Prisma.JsonValue | null) {
  const object = getJsonObject(payload);
  const catalogImportRunId = object?.catalogImportRunId;

  return typeof catalogImportRunId === "string" && catalogImportRunId.trim()
    ? catalogImportRunId
    : null;
}

async function getConnectedEbayConnection(job: DueSyncJob) {
  const connection = await prisma.ebayConnection.findUnique({
    where: {
      shopId_marketplaceId: {
        marketplaceId: getEbayMarketplaceId(job.payload),
        shopId: job.shopId,
      },
    },
  });

  if (!connection || connection.status !== EbayConnectionStatus.CONNECTED) {
    throw new Error("Connessione eBay non collegata per il job SyncBay.");
  }

  return connection;
}

function getOrderLineItems(payload: Prisma.JsonValue | null) {
  const object = getJsonObject(payload);
  const lineItems = object?.lineItems;

  if (!Array.isArray(lineItems)) return [];

  return lineItems.flatMap((lineItem) => {
    const lineItemObject = getJsonObject(lineItem);
    const quantity = getJsonNumber(lineItemObject?.quantity);

    if (!lineItemObject || !quantity || quantity <= 0) return [];

    return [
      {
        lineItemKey: getJsonString(lineItemObject.lineItemKey),
        quantity,
        shopifyProductGid: getJsonString(lineItemObject.shopifyProductGid),
        shopifyVariantGid: getJsonString(lineItemObject.shopifyVariantGid),
      },
    ];
  });
}

function getOrderCurrency(payload: Prisma.JsonValue | null) {
  const object = getJsonObject(payload);

  return getJsonString(object?.orderCurrency);
}

async function findProductMappingForOrderLine(
  shopId: string,
  lineItem: {
    lineItemKey: string | null;
    shopifyProductGid: string | null;
    shopifyVariantGid: string | null;
  },
) {
  if (lineItem.shopifyVariantGid) {
    const mapping = await prisma.productMapping.findFirst({
      where: {
        shopId,
        shopifyVariantGid: lineItem.shopifyVariantGid,
        status: ProductMappingStatus.ACTIVE,
      },
    });

    if (mapping) return mapping;
  }

  if (!lineItem.shopifyProductGid) return null;

  return prisma.productMapping.findFirst({
    where: {
      shopId,
      shopifyProductGid: lineItem.shopifyProductGid,
      status: ProductMappingStatus.ACTIVE,
    },
  });
}

async function hasCompletedStockUpdateForLine(input: {
  ebayItemId: string;
  includeDryRunPlans: boolean;
  job: DueSyncJob;
  lineItem: {
    lineItemKey: string | null;
  };
  mappingId: string;
}) {
  if (!input.lineItem.lineItemKey) return false;

  const snapshot = await prisma.productSnapshot.findFirst({
    select: { id: true },
    where: {
      AND: [
        { payload: { path: ["syncJobId"], equals: input.job.id } },
        {
          payload: {
            path: ["orderLineItemKey"],
            equals: input.lineItem.lineItemKey,
          },
        },
        {
          payload: {
            path: ["updatedEbayFromShopifyOrder"],
            equals: true,
          },
        },
      ],
      mappingId: input.mappingId,
      shopId: input.job.shopId,
      source: ProductSnapshotSource.SYNCBAY,
    },
  });

  if (snapshot) return true;

  const previousJobs = await prisma.syncJob.findMany({
    orderBy: { updatedAt: "desc" },
    select: { result: true },
    take: 50,
    where: {
      id: { not: input.job.id },
      shopId: input.job.shopId,
      status: SyncJobStatus.SUCCEEDED,
      type: SyncJobType.UPDATE_EBAY_STOCK,
    },
  });

  return hasProcessedStockLineInJobResults({
    ebayItemId: input.ebayItemId,
    includeDryRunPlans: input.includeDryRunPlans,
    lineItemKey: input.lineItem.lineItemKey,
    results: previousJobs.flatMap((job) => {
      const result = getJsonObject(job.result);

      return result ? [result] : [];
    }),
  });
}

async function findMappingByInventoryItemGid(
  shopId: string,
  inventoryItemGid: string,
) {
  const recentSnapshots = await prisma.productSnapshot.findMany({
    orderBy: { capturedAt: "desc" },
    take: 300,
    where: {
      shopId,
      source: ProductSnapshotSource.SYNCBAY,
    },
  });
  const snapshot = recentSnapshots.find((candidate) => {
    const payload = getJsonObject(candidate.payload);
    const inventorySync = getJsonObject(payload?.inventorySync ?? null);

    return inventorySync?.inventoryItemGid === inventoryItemGid;
  });

  if (!snapshot?.mappingId) return null;

  return prisma.productMapping.findUnique({
    where: { id: snapshot.mappingId },
  });
}

async function getShopifyProductForConflict(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  productGid: string,
  defaultLocationGid: string | null,
) {
  const query = defaultLocationGid
    ? `#graphql
    query SyncBayProductForConflict($id: ID!, $locationId: ID!) {
      node(id: $id) {
        ... on Product {
          id
          descriptionHtml
          media(first: 50) {
            nodes {
              mediaContentType
              preview {
                status
              }
            }
          }
          status
          title
          variants(first: 1) {
            nodes {
              inventoryQuantity
              price
              inventoryItem {
                tracked
                inventoryLevel(locationId: $locationId) {
                  quantities(names: ["available"]) {
                    name
                    quantity
                  }
                }
              }
            }
          }
        }
      }
    }`
    : `#graphql
    query SyncBayProductForConflict($id: ID!) {
      node(id: $id) {
        ... on Product {
          id
          descriptionHtml
          media(first: 50) {
            nodes {
              mediaContentType
              preview {
                status
              }
            }
          }
          status
          title
          variants(first: 1) {
            nodes {
              inventoryQuantity
              price
              inventoryItem {
                tracked
              }
            }
          }
        }
      }
    }`;
  const variables = defaultLocationGid
    ? { id: productGid, locationId: defaultLocationGid }
    : { id: productGid };
  const response = await admin.graphql(query, { variables });

  if (!response.ok) return null;

  const json = (await response.json()) as ShopifyProductForConflictResponse;

  if (json.errors?.length) return null;

  return json.data?.node ?? null;
}

function getDetectedShopifyConflicts(
  product: ShopifyProductForConflict,
  snapshot: {
    descriptionHash: string | null;
    imageCount: number | null;
    priceAmount: Prisma.Decimal | null;
    productStatus: string | null;
    quantity: number | null;
    title: string | null;
  },
  hasManagedLocation: boolean,
) {
  const variant = product.variants?.nodes?.[0] ?? null;
  const variantLocationQuantity = getVariantLocationQuantity(variant);
  const shopifyQuantity = hasManagedLocation
    ? variantLocationQuantity
    : (variantLocationQuantity ?? variant?.inventoryQuantity);
  const readyImageCount =
    product.media?.nodes?.filter(
      (media) =>
        media.mediaContentType === "IMAGE" && media.preview?.status === "READY",
    ).length ?? 0;
  const quantityConflict = shouldSkipQuantityConflictForArchivedProduct({
    shopifyProductStatus: product.status ?? null,
    syncBayProductStatus: snapshot.productStatus,
    syncBayQuantity: snapshot.quantity,
  })
    ? null
    : buildConflict("quantity", snapshot.quantity, shopifyQuantity);
  const imagesConflict = shouldSkipImagesConflictWhenEbayHasNoImages({
    syncBayImageCount: snapshot.imageCount,
    shopifyImageCount: readyImageCount,
  })
    ? null
    : buildConflict("images", snapshot.imageCount, readyImageCount);
  const fields = [
    buildConflict("title", snapshot.title, product.title),
    buildConflict(
      "description",
      snapshot.descriptionHash,
      hashNullableText(product.descriptionHtml ?? null),
    ),
    buildConflict("status", snapshot.productStatus, product.status),
    buildConflict(
      "price",
      snapshot.priceAmount?.toFixed(2) ?? null,
      variant?.price ?? null,
    ),
    quantityConflict,
    imagesConflict,
  ];

  return fields.filter(
    (
      field,
    ): field is {
      ebayValue: Prisma.JsonValue;
      field: string;
      lastSyncBayValue: Prisma.JsonValue;
      shopifyValue: Prisma.JsonValue;
    } => Boolean(field),
  );
}

function getVariantLocationQuantity(
  variant:
    | NonNullable<
        NonNullable<ShopifyProductForConflict["variants"]>["nodes"]
      >[number]
    | null,
) {
  const availableQuantity =
    variant?.inventoryItem?.inventoryLevel?.quantities?.find(
      (quantity) => quantity.name === "available",
    )?.quantity;

  return typeof availableQuantity === "number" ? availableQuantity : null;
}

function buildConflict(
  field: string,
  lastSyncBayValue: Prisma.JsonValue | undefined,
  shopifyValue: Prisma.JsonValue | undefined,
) {
  const normalizedLastValue = normalizeConflictValue(lastSyncBayValue);
  const normalizedShopifyValue = normalizeConflictValue(shopifyValue);

  if (normalizedLastValue === normalizedShopifyValue) return null;

  return {
    ebayValue: normalizedLastValue,
    field,
    lastSyncBayValue: normalizedLastValue,
    shopifyValue: normalizedShopifyValue,
  };
}

async function upsertOpenConflict(input: {
  ebayValue: Prisma.JsonValue;
  field: string;
  lastSyncBayValue: Prisma.JsonValue;
  mappingId: string;
  shopId: string;
  shopifyValue: Prisma.JsonValue;
}) {
  const existing = await prisma.syncConflict.findFirst({
    where: {
      field: input.field,
      mappingId: input.mappingId,
      shopId: input.shopId,
      status: SyncConflictStatus.OPEN,
    },
  });

  if (existing) {
    await prisma.syncConflict.update({
      data: {
        detectedAt: new Date(),
        ebayValue: toNullableJsonInput(input.ebayValue),
        lastSyncBayValue: toNullableJsonInput(input.lastSyncBayValue),
        shopifyValue: toNullableJsonInput(input.shopifyValue),
      },
      where: { id: existing.id },
    });
    return;
  }

  await prisma.syncConflict.create({
    data: {
      ebayValue: toNullableJsonInput(input.ebayValue),
      field: input.field,
      lastSyncBayValue: toNullableJsonInput(input.lastSyncBayValue),
      mappingId: input.mappingId,
      shopId: input.shopId,
      shopifyValue: toNullableJsonInput(input.shopifyValue),
    },
  });
}

async function resolveAlignedOpenConflicts(input: {
  detectedConflictFields: string[];
  mappingId: string;
  shopId: string;
}) {
  const openConflicts = await prisma.syncConflict.findMany({
    select: { field: true },
    where: {
      mappingId: input.mappingId,
      shopId: input.shopId,
      status: SyncConflictStatus.OPEN,
    },
  });
  const alignedFields = getAlignedOpenConflictFields({
    detectedConflictFields: input.detectedConflictFields,
    openConflictFields: openConflicts.map((conflict) => conflict.field),
  });

  if (alignedFields.length === 0) return 0;

  const result = await prisma.syncConflict.updateMany({
    data: {
      resolvedAt: new Date(),
      status: SyncConflictStatus.RESOLVED,
    },
    where: {
      field: { in: alignedFields },
      mappingId: input.mappingId,
      shopId: input.shopId,
      status: SyncConflictStatus.OPEN,
    },
  });

  return result.count;
}

async function resolveLiveAlignedDescriptionConflicts(input: {
  conflicts: {
    field: string;
    id: string;
    mappingId: string | null;
    mapping: {
      shopifyProductGid: string | null;
      status: ProductMappingStatus;
    } | null;
  }[];
  defaultLocationGid: string | null;
  shopId: string;
  shopDomain: string;
}) {
  const candidates = input.conflicts.filter(
    (conflict) =>
      conflict.field === "description" &&
      conflict.mappingId &&
      conflict.mapping?.shopifyProductGid &&
      shouldResolveLiveAlignedDescriptionConflictForMappingStatus(
        conflict.mapping?.status ?? null,
      ),
  );
  const mappingIds = [
    ...new Set(candidates.flatMap((conflict) => conflict.mappingId ?? [])),
  ];

  if (mappingIds.length === 0) {
    return { conflictIds: [], count: 0 };
  }

  const latestDescriptionSnapshots = await prisma.productSnapshot.findMany({
    orderBy: { capturedAt: "desc" },
    select: { descriptionHash: true, mappingId: true, payload: true },
    where: {
      descriptionHash: { not: null },
      mappingId: { in: mappingIds },
      shopId: input.shopId,
      source: ProductSnapshotSource.SYNCBAY,
    },
  });
  const latestDescriptionHashByMappingId = new Map<string, string>();

  for (const snapshot of latestDescriptionSnapshots) {
    if (
      snapshot.mappingId &&
      snapshot.descriptionHash &&
      !latestDescriptionHashByMappingId.has(snapshot.mappingId) &&
      shouldUseSyncBayDescriptionBaselinePayload(snapshot.payload)
    ) {
      latestDescriptionHashByMappingId.set(
        snapshot.mappingId,
        snapshot.descriptionHash,
      );
    }
  }

  const admin = await getShopifyAdminGraphqlClient(input.shopDomain);
  const conflictIds: string[] = [];

  for (const conflict of candidates) {
    const latestSyncBayDescriptionHash = conflict.mappingId
      ? (latestDescriptionHashByMappingId.get(conflict.mappingId) ?? null)
      : null;
    const shopifyProductGid = conflict.mapping?.shopifyProductGid ?? null;

    if (!latestSyncBayDescriptionHash || !shopifyProductGid) {
      continue;
    }

    const product = await getShopifyProductForConflict(
      admin,
      shopifyProductGid,
      input.defaultLocationGid,
    );
    const currentShopifyDescriptionHash = product
      ? hashNullableText(product.descriptionHtml ?? null)
      : null;

    if (isLiveDescriptionConflictAligned({
      currentShopifyDescriptionHash,
      field: conflict.field,
      latestSyncBayDescriptionHash,
    })) {
      conflictIds.push(conflict.id);
    }
  }

  if (conflictIds.length === 0) {
    return { conflictIds: [], count: 0 };
  }

  const result = await prisma.syncConflict.updateMany({
    data: {
      resolvedAt: new Date(),
      status: SyncConflictStatus.RESOLVED,
    },
    where: {
      id: { in: conflictIds },
      shopId: input.shopId,
      status: SyncConflictStatus.OPEN,
    },
  });

  return { conflictIds, count: result.count };
}

async function resolveOpenConflictsForInactiveMapping(input: {
  mappingId: string;
  shopId: string;
}) {
  const result = await resolveOpenConflictsForInactiveMappingMutation(input);

  return result.count;
}

function resolveOpenConflictsForInactiveMappingMutation(input: {
  mappingId: string;
  resolvedAt?: Date;
  shopId: string;
}) {
  return prisma.syncConflict.updateMany({
    data: {
      resolvedAt: input.resolvedAt ?? new Date(),
      status: SyncConflictStatus.RESOLVED,
    },
    where: {
      mappingId: input.mappingId,
      shopId: input.shopId,
      status: SyncConflictStatus.OPEN,
    },
  });
}

function getJsonObject(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  return value as Record<string, Prisma.JsonValue>;
}

function toNullableJsonInput(value: Prisma.JsonValue) {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function getJsonNumber(value: Prisma.JsonValue | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getJsonString(value: Prisma.JsonValue | undefined) {
  return typeof value === "string" ? value : null;
}

function getStringFromPayload(payload: Prisma.JsonValue | null, key: string) {
  return getJsonString(getJsonObject(payload)?.[key]);
}

function getDateFromPayload(payload: Prisma.JsonValue | null, key: string) {
  const value = getStringFromPayload(payload, key);
  if (!value) return null;

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function getRetryAfter(attempts: number, from = new Date()) {
  const retryDelaySeconds = attempts <= 1 ? 60 : attempts === 2 ? 300 : 900;

  return new Date(from.getTime() + retryDelaySeconds * 1000);
}

function normalizeRunDueLimit(limit?: number) {
  if (!Number.isInteger(limit)) return DEFAULT_RUN_DUE_LIMIT;

  return Math.min(Math.max(Number(limit), 1), MAX_RUN_DUE_LIMIT);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;

  return "Errore inatteso durante l'esecuzione del job SyncBay.";
}

function getRunnableSyncJobTypes() {
  return [
    SyncJobType.UPDATE_EBAY_STOCK,
    SyncJobType.SYNC_INCREMENTAL,
    SyncJobType.ARCHIVE_INACTIVE_LISTING,
    SyncJobType.DETECT_SHOPIFY_CHANGES,
    SyncJobType.IMPORT_CATALOG,
  ];
}

function normalizeConflictValue(value: Prisma.JsonValue | undefined) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim();

  return value;
}

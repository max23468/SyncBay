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
  buildCatalogReconcilePlan,
  isCatalogReconcileScanComplete,
} from "../lib/syncbay-catalog-reconcile";
import { hashNullableText } from "../lib/syncbay-description-hash";
import {
  buildEbayItemJobSplitIdempotencyKey,
  buildEbayItemJobSplitPayloads,
  isSchedulableSyncJob,
  isStaleInternalShopifyImportJob,
} from "../lib/syncbay-job-scheduling";
import {
  createShopifyAdminGraphqlClient,
  getOfflineShopifySessionId,
} from "../lib/syncbay-shopify-admin";
import { getRecoverableRunningSyncJobTypes } from "../lib/syncbay-stale-job-recovery";
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
} from "./ebay-trading-preview.server";
import { reviseEbayTradingInventoryQuantity } from "./ebay-trading-stock.server";
import type {
  ImportPreviewItem,
  ImportPreviewResult,
  ImportPreviewSummary,
} from "./import-preview.server";
import { buildImportPreview } from "./import-preview.server";
import { createShopifyDraftProductsIfEnabled } from "./shopify-draft-import.server";

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
type ShopifyProductArchiveResponse = {
  data?: {
    productUpdate?: {
      product?: {
        id: string;
        status?: string | null;
      } | null;
      userErrors?: Array<{ field?: string[] | null; message: string }>;
    } | null;
  };
  errors?: Array<{ message: string }>;
};

const DEFAULT_RUN_DUE_LIMIT = 5;
const MAX_RUN_DUE_LIMIT = 10;
const DEFAULT_MARKETPLACE_ID = "EBAY_IT";
const CATALOG_RECONCILE_MAX_PRODUCTS = 2000;
const RUNNER_EBAY_ITEM_BATCH_SIZE = 10;
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

  return {
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
          message:
            "Traccia interna import Shopify stantia chiusa dal runner.",
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
      select: { finishedAt: true, createdAt: true },
      where: {
        shopId: shop.id,
        type: SyncJobType.SYNC_INCREMENTAL,
      },
    });
    const nextRunAfter = lastJob
      ? new Date(
          (lastJob.finishedAt ?? lastJob.createdAt).getTime() +
            shop.syncTargetSeconds * 1000,
        )
      : now;

    if (nextRunAfter > now) continue;

    try {
      const connection = shop.ebayConnections[0];
      const { accessToken } = await getUsableEbayAccessToken(connection);
      const activeCatalogPlan = await getEbayTradingCatalogImportPlan({
        accessToken,
        connection,
        maxProducts: CATALOG_RECONCILE_MAX_PRODUCTS,
      });
      const mappings = await prisma.productMapping.findMany({
        orderBy: { updatedAt: "asc" },
        select: { ebayItemId: true },
        where: {
          marketplaceId: DEFAULT_MARKETPLACE_ID,
          shopId: shop.id,
          status: ProductMappingStatus.ACTIVE,
        },
      });
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
        continue;
      }

      const runId = `incremental:${shop.id}:${now.toISOString()}`;
      const syncJobs = reconcilePlan.syncBatches.map((ebayItemIds, index) => ({
        maxAttempts: INCREMENTAL_SYNC_MAX_ATTEMPTS,
        payload: {
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
        runAfter: now,
        shopId: shop.id,
        status: SyncJobStatus.PENDING,
        type: SyncJobType.SYNC_INCREMENTAL,
      }));
      const archiveJobs = reconcilePlan.inactiveEbayItemIds.map(
        (ebayItemId) => ({
          idempotencyKey: `archive-inactive:${shop.id}:${DEFAULT_MARKETPLACE_ID}:${ebayItemId}:${runId}`,
          maxAttempts: INCREMENTAL_SYNC_MAX_ATTEMPTS,
          payload: {
            activeCatalogReadCount: activeCatalogPlan.readCount,
            activeCatalogTotalAvailable: activeCatalogPlan.totalAvailable,
            ebayItemId,
            marketplaceId: DEFAULT_MARKETPLACE_ID,
            runId,
            source: "catalog_reconcile",
          } satisfies Prisma.JsonObject,
          runAfter: now,
          shopId: shop.id,
          status: SyncJobStatus.PENDING,
          type: SyncJobType.ARCHIVE_INACTIVE_LISTING,
        }),
      );

      await prisma.syncJob.createMany({
        data: [...syncJobs, ...archiveJobs],
        skipDuplicates: true,
      });
    } catch (error) {
      await prisma.auditLog.create({
        data: {
          details: {
            runnerErrorCode: "SYNCBAY_INCREMENTAL_ENQUEUE_FAILED",
            runnerErrorMessage: getErrorMessage(error),
          } satisfies Prisma.JsonObject,
          message:
            "Pianificazione sync catalogo incrementale non completata; il runner continuerà con i job già in coda.",
          shopId: shop.id,
          type: AuditEventType.SYNC_JOB_FAILED,
        },
      });
    }
  }
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
      return await runArchiveInactiveListingJob(job);
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
    await markJobFailedOrRetrying({
      errorCode: "SYNCBAY_JOB_RUNNER_FAILED",
      errorMessage: getErrorMessage(error),
      job,
    });

    return {
      errorMessage: getErrorMessage(error),
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

  if (await splitOversizedEbayItemJobIfNeeded(job, ebayItemIds)) {
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

  if (await splitOversizedEbayItemJobIfNeeded(job, ebayItemIds)) {
    return {
      jobId: job.id,
      status: "succeeded" as const,
      type: job.type,
    };
  }

  const openConflictItemIds = new Set(
    (
      await prisma.syncConflict.findMany({
        select: {
          mapping: {
            select: { ebayItemId: true },
          },
        },
        where: {
          mapping: { ebayItemId: { in: ebayItemIds } },
          shopId: job.shopId,
          status: SyncConflictStatus.OPEN,
        },
      })
    ).flatMap((conflict) =>
      conflict.mapping?.ebayItemId ? [conflict.mapping.ebayItemId] : [],
    ),
  );
  const syncableItemIds = ebayItemIds.filter(
    (itemId) => !openConflictItemIds.has(itemId),
  );

  if (syncableItemIds.length === 0) {
    await markJobSucceeded({
      delegatedJobId: null,
      job,
      result: {
        conflictSkippedCount: ebayItemIds.length,
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

  const connection = await getConnectedEbayConnection(job);
  const [admin, previewResult] = await Promise.all([
    getShopifyAdminGraphqlClient(job.shop.shopDomain),
    getImportPreviewResultByItemIds(connection, syncableItemIds),
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
      conflictSkippedCount: openConflictItemIds.size,
      requestedCount: ebayItemIds.length,
      syncedCount: syncableItemIds.length,
    },
    warnings: result.warnings ?? [],
  });

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

    if (await hasCompletedStockUpdateForLine(job, mapping.id, lineItem)) {
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
    const lineDryRun = shouldDryRunEbayStockLine({
      allowlist: process.env.SYNCBAY_EBAY_STOCK_REAL_WRITE_ALLOWLIST,
      ebayItemId: mapping.ebayItemId,
      shopDomain: job.shop.shopDomain,
      shopifyVariantGid: mapping.shopifyVariantGid,
      stockDryRunEnabled: stockDryRun,
    });

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

async function runArchiveInactiveListingJob(job: DueSyncJob) {
  const ebayItemId = getArchiveEbayItemId(job.payload);

  if (!ebayItemId) {
    throw new Error("Job archivio listing inattivo senza eBay ItemID.");
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
        archivedCount: 0,
        ebayItemId,
        skippedReason: "active_mapping_not_found",
      },
      warnings: ["Archivio saltato: mapping attivo non trovato."],
    });

    return {
      jobId: job.id,
      status: "succeeded" as const,
      type: job.type,
    };
  }

  if (mapping.shopifyProductGid) {
    const admin = await getShopifyAdminGraphqlClient(job.shop.shopDomain);
    await archiveShopifyProduct(admin, mapping.shopifyProductGid);
  }

  const now = new Date();

  await prisma.$transaction([
    prisma.productMapping.update({
      data: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncedAt: now,
        status: ProductMappingStatus.ARCHIVED,
      },
      where: { id: mapping.id },
    }),
    prisma.productSnapshot.create({
      data: {
        ebayItemId: mapping.ebayItemId,
        mappingId: mapping.id,
        payload: {
          archivedShopifyProduct: Boolean(mapping.shopifyProductGid),
          reason: "ebay_listing_inactive",
          syncJobId: job.id,
        } satisfies Prisma.JsonObject,
        productStatus: "ARCHIVED",
        quantity: 0,
        shopId: job.shopId,
        shopifyProductGid: mapping.shopifyProductGid,
        shopifyVariantGid: mapping.shopifyVariantGid,
        sku: mapping.sku,
        source: ProductSnapshotSource.SYNCBAY,
      },
    }),
  ]);

  await markJobSucceeded({
    delegatedJobId: null,
    job,
    result: {
      archivedCount: 1,
      archivedShopifyProduct: Boolean(mapping.shopifyProductGid),
      ebayItemId,
      shopifyProductGid: mapping.shopifyProductGid,
    },
    warnings: mapping.shopifyProductGid
      ? []
      : ["Mapping archiviato senza prodotto Shopify collegato."],
  });

  return {
    jobId: job.id,
    status: "succeeded" as const,
    type: job.type,
  };
}

async function getShopifyAdminGraphqlClient(shopDomain: string) {
  const session = await prisma.session.findUnique({
    select: { accessToken: true },
    where: { id: getOfflineShopifySessionId(shopDomain) },
  });

  if (!session?.accessToken) {
    throw new Error(
      "Sessione offline Shopify non disponibile per il runner automatico.",
    );
  }

  return createShopifyAdminGraphqlClient({
    accessToken: session.accessToken,
    shopDomain,
  });
}

async function archiveShopifyProduct(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  productGid: string,
) {
  const response = await admin.graphql(
    `#graphql
    mutation SyncBayArchiveInactiveProduct($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        product: {
          id: productGid,
          status: "ARCHIVED",
        },
      },
    },
  );

  if (!response.ok) {
    throw new Error("Shopify non ha accettato la richiesta di archivio.");
  }

  const json = (await response.json()) as ShopifyProductArchiveResponse;
  const graphQLError = json.errors?.[0]?.message;
  const userError = json.data?.productUpdate?.userErrors?.[0]?.message;

  if (graphQLError || userError) {
    throw new Error(
      graphQLError ?? userError ?? "Archivio prodotto Shopify non riuscito.",
    );
  }
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

  await markJobSucceeded({
    delegatedJobId: null,
    job,
    result: {
      conflictCount: conflicts.length,
      fields: conflicts.map((conflict) => conflict.field),
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
    findLatestSyncBaySnapshotWithField(mappingId, { imageCount: { not: null } }),
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
  return prisma.productSnapshot.findFirst({
    orderBy: { capturedAt: "desc" },
    where: {
      mappingId,
      NOT: [
        {
          AND: [
            {
              payload: {
                path: ["updatedEbayFromShopifyOrder"],
                equals: true,
              },
            },
            {
              payload: {
                path: ["conflictResolution"],
                equals: Prisma.DbNull,
              },
            },
          ],
        },
        {
          AND: [
            {
              payload: {
                path: ["restoredEbayAfterTest"],
                equals: true,
              },
            },
            {
              payload: {
                path: ["conflictResolution"],
                equals: Prisma.DbNull,
              },
            },
          ],
        },
      ],
      source: ProductSnapshotSource.SYNCBAY,
    },
  });
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

async function markJobFailedOrRetrying(input: {
  errorCode: string;
  errorMessage: string;
  job: DueSyncJob;
}) {
  const nextAttempts = input.job.attempts + 1;
  const retryAt =
    nextAttempts < input.job.maxAttempts ? getRetryAfter(nextAttempts) : null;
  const result = {
    runnerErrorCode: input.errorCode,
    runnerErrorMessage: input.errorMessage,
    retryScheduledAt: retryAt?.toISOString() ?? null,
    willRetry: Boolean(retryAt),
  } satisfies Prisma.JsonObject;

  await prisma.$transaction([
    prisma.syncJob.update({
      data: {
        attempts: { increment: 1 },
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        finishedAt: new Date(),
        result,
        runAfter: retryAt ?? undefined,
        status: retryAt ? SyncJobStatus.RETRYING : SyncJobStatus.FAILED,
      },
      where: { id: input.job.id },
    }),
    prisma.auditLog.create({
      data: {
        details: result,
        message: retryAt
          ? "Job SyncBay non completato; retry pianificato dal runner."
          : "Job SyncBay non completato dal runner.",
        shopId: input.job.shopId,
        type: AuditEventType.SYNC_JOB_FAILED,
      },
    }),
  ]);
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

  await prisma.$transaction([
    prisma.syncJob.update({
      data: {
        errorCode: null,
        errorMessage: null,
        finishedAt: new Date(),
        result,
        status: SyncJobStatus.SUCCEEDED,
      },
      where: { id: input.job.id },
    }),
    prisma.auditLog.create({
      data: {
        details: result,
        message: "Job SyncBay completato dal runner.",
        shopId: input.job.shopId,
        type: AuditEventType.SYNC_JOB_SUCCEEDED,
      },
    }),
  ]);
}

async function splitOversizedEbayItemJobIfNeeded(
  job: DueSyncJob,
  ebayItemIds: string[],
) {
  if (ebayItemIds.length <= RUNNER_EBAY_ITEM_BATCH_SIZE) return false;

  const payload = getJsonObject(job.payload);

  if (!payload) return false;

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

  await prisma.$transaction([
    prisma.syncJob.createMany({
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
    }),
    prisma.syncJob.update({
      data: {
        errorCode: null,
        errorMessage: null,
        finishedAt: now,
        result,
        status: SyncJobStatus.SUCCEEDED,
      },
      where: { id: job.id },
    }),
    prisma.auditLog.create({
      data: {
        details: result,
        message:
          "Job SyncBay spezzato in batch più piccoli per il runner automatico.",
        shopId: job.shopId,
        type: AuditEventType.SYNC_JOB_SUCCEEDED,
      },
    }),
  ]);

  return true;
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

async function hasCompletedStockUpdateForLine(
  job: DueSyncJob,
  mappingId: string,
  lineItem: {
    lineItemKey: string | null;
  },
) {
  if (!lineItem.lineItemKey) return false;

  const snapshot = await prisma.productSnapshot.findFirst({
    select: { id: true },
    where: {
      AND: [
        { payload: { path: ["syncJobId"], equals: job.id } },
        {
          payload: {
            path: ["orderLineItemKey"],
            equals: lineItem.lineItemKey,
          },
        },
        {
          payload: {
            path: ["updatedEbayFromShopifyOrder"],
            equals: true,
          },
        },
      ],
      mappingId,
      shopId: job.shopId,
      source: ProductSnapshotSource.SYNCBAY,
    },
  });

  return Boolean(snapshot);
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
  const response = await admin.graphql(
    query,
    { variables },
  );

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
    buildConflict(
      "quantity",
      snapshot.quantity,
      shopifyQuantity,
    ),
    buildConflict("images", snapshot.imageCount, readyImageCount),
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
  const availableQuantity = variant?.inventoryItem?.inventoryLevel?.quantities
    ?.find((quantity) => quantity.name === "available")
    ?.quantity;

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

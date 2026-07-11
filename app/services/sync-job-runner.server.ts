import {
  AuditEventType,
  EbayConnection,
  EbayConnectionStatus,
  ProductMappingStatus,
  ProductSnapshotSource,
  Prisma,
  SyncConflictResolution,
  SyncConflictStatus,
  SyncJobStatus,
  SyncJobType,
} from "@prisma/client";

import prisma from "../db.server";
import { normalizeImportProductStatus } from "../lib/import-product-status";
import { SYNCBAY_AUDIT_LOG_CREATE_SELECT } from "../lib/syncbay-audit-log-write";
import { getCatalogReconcileBlockingJobTypes } from "../lib/syncbay-catalog-reconcile-blockers";
import { parseExistingCatalogFieldPoliciesByItemId } from "../lib/syncbay-existing-catalog-field-policy";
import {
  SYNCBAY_DESCRIPTION_BASELINE_PAYLOAD_SQL,
  getAlignedOpenConflictFields,
  isLiveDescriptionConflictAligned,
  normalizeProductStatusConflictValue,
  shouldBlockIncrementalSyncForOpenConflictMappingStatus,
  shouldResolveLiveAlignedDescriptionConflictForMappingStatus,
  shouldResolveLiveAlignedPriceConflictForMappingStatus,
  shouldResolveOpenConflictsForInactiveMappingStatus,
  shouldResolveOrderStockQuantityConflict,
  shouldSkipDescriptionConflictWhenEbayHasNoDescription,
  shouldSkipImagesConflictWhenEbayHasNoImages,
  shouldSkipQuantityConflictForArchivedProduct,
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
  getCatalogImageRepairCandidateWhere,
  getCatalogImageRepairItemIds,
  getCatalogImageRepairRunKey,
} from "../lib/syncbay-catalog-image-repair";
import { hashNullableText } from "../lib/syncbay-description-hash";
import {
  getSellerEventsDeltaWindow,
  getSellerEventsWatermarkAt,
  isFullCatalogReconcileDue,
  shouldAdvanceCatalogReconcileRunWatermark,
  shouldAdvanceSellerEventsRunWatermark,
} from "../lib/syncbay-ebay-delta-sync";
import {
  getNextEbayTradingRateLimitRetryAt,
  isEbayTradingUsageLimitError,
} from "../lib/syncbay-ebay-rate-limit";
import { isPricingOnlySyncJobPayload } from "../lib/syncbay-pricing-rule-sync";
import { shouldCreateProductSnapshot } from "../lib/syncbay-product-snapshot-dedupe";
import { getProductFacetBaselineFromSnapshotPayload } from "../lib/syncbay-product-snapshot-payload";
import { buildSnapshotPricingSourcesByItemId } from "../lib/syncbay-pricing-source";
import {
  buildPriceConflictValue,
  getFinalizedPriceConflictRepairIds,
  getAlignedPriceConflictRepair,
  getPriceConflictRepairSnapshotVariantGid,
} from "../lib/syncbay-price-conflict-alignment";
import {
  calculateShopifyPricing,
  shouldWriteShopifyPricing,
  type SyncBayPricingWriteBaseline,
} from "../lib/syncbay-pricing-rules";
import { type SyncBayProductFacet } from "../lib/syncbay-product-facets";
import { hasSyncBayProductFacetBaselineChanged } from "../lib/syncbay-product-facet-baseline";
import { buildSyncBayProductFacetProposalFromSnapshot } from "../lib/syncbay-product-facet-proposal";
import {
  mergePreferredShopifyVariantForSync,
  selectShopifyVariantForSync,
} from "../lib/syncbay-shopify-variant-selection";
import { selectLatestStockBaselineSnapshot } from "../lib/syncbay-stock-baseline";
import {
  getNextIncrementalEnqueueAt,
  shouldEnqueueIncrementalSyncNow,
} from "../lib/syncbay-incremental-schedule";
import {
  FACET_BACKFILL_INCREMENTAL_JOB_SOURCE,
  SHOPIFY_IMPORT_JOB_IDEMPOTENCY_PREFIX,
  SHOPIFY_IMPORT_JOB_SOURCE,
  buildEbayItemJobSplitIdempotencyKey,
  buildEbayItemJobSplitPayloads,
  buildSellerEventsNoopMarker,
  isSchedulableSyncJob,
  isStaleInternalShopifyImportJob,
  normalizeRunDueLimit,
} from "../lib/syncbay-job-scheduling";
import { runRetentionCleanup } from "./retention-cleanup.server";
import { shouldContinueRunningSyncJob } from "../lib/syncbay-runner-cancellation";
import {
  buildShopifyChangeBatch,
  type ShopifyChangeBatchJob,
} from "../lib/syncbay-shopify-change-batch";
import {
  RUNNER_LANES,
  buildRunnerLanePlan,
  shouldClaimRunnerJob,
  type RunnerLane,
} from "../lib/syncbay-runner-fairness";
import {
  STALE_FAILED_INCREMENTAL_SYNC_ARCHIVE_AFTER_MS,
  STALE_FAILED_INCREMENTAL_SYNC_ERROR_CODES,
} from "../lib/syncbay-stale-failed-job-archive";
import { getRecoverableRunningSyncJobTypes } from "../lib/syncbay-stale-job-recovery";
import { hasProcessedStockLineInJobResults } from "../lib/syncbay-stock-job-idempotency";
import {
  isEbayStockDryRunEnabled,
  isPositiveShopifyOrderQuantity,
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
import { syncShopifyProductFacets } from "./syncbay-product-facets.server";
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
import { getPricingRuleForShopId } from "./pricing-rules.server";
import { detectShopifyChangesBatch } from "./shopify-conflict-detection.server";

const dueSyncJobSelect = {
  attempts: true,
  createdAt: true,
  finishedAt: true,
  id: true,
  idempotencyKey: true,
  maxAttempts: true,
  payload: true,
  result: true,
  shop: {
    select: {
      defaultLocationGid: true,
      shopDomain: true,
    },
  },
  shopId: true,
  startedAt: true,
  status: true,
  type: true,
} satisfies Prisma.SyncJobSelect;

type DueSyncJob = Prisma.SyncJobGetPayload<{ select: typeof dueSyncJobSelect }>;
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
      compareAtPrice?: string | null;
      inventoryItem?: {
        inventoryLevel?: {
          quantities?: Array<{
            name?: string | null;
            quantity?: number | null;
          }> | null;
        } | null;
        tracked?: boolean | null;
      } | null;
      id?: string | null;
      inventoryQuantity?: number | null;
      price?: string | null;
    }>;
  } | null;
};
type ShopifyProductForConflictVariant = NonNullable<
  NonNullable<ShopifyProductForConflict["variants"]>["nodes"]
>[number];
type ShopifyProductForConflictMappedVariant =
  ShopifyProductForConflictVariant & {
    product?: {
      id?: string | null;
    } | null;
  };
type ShopifyProductForConflictResponse = {
  data?: {
    productNode?: ShopifyProductForConflict | null;
    variantNode?: ShopifyProductForConflictMappedVariant | null;
  };
  errors?: Array<{ message: string }>;
};
type ShopifyUserError = {
  field?: string[] | null;
  message: string;
};
type ShopifyPricingVariantUpdateResponse = {
  data?: {
    productVariantsBulkUpdate?: {
      productVariants?: Array<{
        compareAtPrice?: string | null;
        id: string;
        price?: string | null;
      }>;
      userErrors?: ShopifyUserError[];
    } | null;
  };
  errors?: Array<{ message: string }>;
};
const DEFAULT_MARKETPLACE_ID = "EBAY_IT";
const CATALOG_RECONCILE_MAX_PRODUCTS = 2000;
const RUNNER_EBAY_ITEM_BATCH_SIZE = 10;
const CATALOG_IMAGE_REPAIR_DEFAULT_LIMIT = 20;
const CATALOG_IMAGE_REPAIR_MAX_LIMIT = 100;
const FACET_BACKFILL_MAX_ACTIVE_BATCHES = 2;
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
    deadlineAt?: Date;
    limit?: number;
    now?: Date;
  } = {},
) {
  const startedAt = Date.now();
  const now = input.now ?? new Date();
  const limit = normalizeRunDueLimit(input.limit);

  await enqueueIncrementalSyncJobs(now);
  await recoverStaleRunningSyncJobsForDueShops({ limit, now });
  const cleanedInternalImportJobCount =
    await markStaleInternalShopifyImportJobsFailed({ limit, now });

  const dueByType = await countDueSyncJobsByType(now);
  const schedulableDueByType = { ...dueByType };
  const runnableTypes = new Set<SyncJobType>(getRunnableSyncJobTypes());
  for (const lane of RUNNER_LANES) {
    if (!runnableTypes.has(lane as SyncJobType)) {
      schedulableDueByType[lane] = 0;
    }
  }
  const lanePlan = buildRunnerLanePlan({ dueByType: schedulableDueByType, limit });
  const jobs = await findDueSyncJobsByPriority({ lanePlan, now });
  const results = new Array<DueSyncJobRunResult>(jobs.length);
  const runnableJobsByShop = new Map<string, DueSyncJobRunQueueItem[]>();
  const deadlineState = { continuationNeeded: false };

  for (const [index, job] of jobs.entries()) {
    const shopJobs = runnableJobsByShop.get(job.shopId) ?? [];
    shopJobs.push({ index, job });
    runnableJobsByShop.set(job.shopId, shopJobs);
  }

  await Promise.all(
    [...runnableJobsByShop.values()].map((shopJobs) =>
      runDueSyncJobGroup(
        shopJobs,
        results,
        now,
        input.deadlineAt,
        deadlineState,
      ),
    ),
  );

  const completedResults = results.filter(
    (result): result is DueSyncJobRunResult => Boolean(result),
  );
  const archivedStaleFailedJobCount =
    await archiveSupersededFailedIncrementalSyncJobs({ now });
  const retentionCleanup = await runRetentionCleanup({ now });
  const selectedByType = buildRunnerLaneCounts(
    completedResults.map((result) => result.type as RunnerLane),
  );
  const dueCount = Object.values(dueByType).reduce(
    (total, count) => total + count,
    0,
  );

  return {
    archivedStaleFailedJobCount,
    failedCount: completedResults.filter((result) => result.status === "failed")
      .length,
    processedCount: completedResults.length,
    skippedCount: completedResults.filter(
      (result) => result.status === "skipped",
    ).length,
    cleanedInternalImportJobCount,
    continuationNeeded:
      deadlineState.continuationNeeded || dueCount > completedResults.length,
    dueByType,
    elapsedMs: Date.now() - startedAt,
    retentionCleanup,
    selectedByType,
    succeededCount: completedResults.filter(
      (result) => result.status === "succeeded",
    ).length,
    results: completedResults,
  };
}

async function countDueSyncJobsByType(now: Date) {
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

function buildRunnerLaneCounts(lanes: RunnerLane[]) {
  const counts = Object.fromEntries(
    RUNNER_LANES.map((lane) => [lane, 0]),
  ) as Record<RunnerLane, number>;

  for (const lane of lanes) counts[lane] += 1;

  return counts;
}

async function findDueSyncJobsByPriority(input: {
  lanePlan: RunnerLane[];
  now: Date;
}) {
  const jobs: DueSyncJob[] = [];

  for (const lane of input.lanePlan) {
    const type = lane as SyncJobType;
    if (type === SyncJobType.SYNC_INCREMENTAL) {
      const regularJobs = await findDueRegularIncrementalSyncJobs({
        excludeIds: jobs.map((job) => job.id),
        limit: 1,
        now: input.now,
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

async function findDueRegularIncrementalSyncJobs(input: {
  excludeIds?: string[];
  limit: number;
  now: Date;
}) {
  if (input.limit <= 0) return [];

  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "SyncJob"
    WHERE "type"::text = ${SyncJobType.SYNC_INCREMENTAL}
      AND "status"::text IN (${Prisma.join([
        SyncJobStatus.PENDING,
        SyncJobStatus.RETRYING,
      ])})
      AND "runAfter" <= ${input.now}
      AND NOT COALESCE("payload" @> '{"facetOnly": true}'::jsonb, false)
      AND COALESCE("payload"->>'source', '') <> ${FACET_BACKFILL_INCREMENTAL_JOB_SOURCE}
      AND COALESCE("payload"->>'source', '') <> ${SHOPIFY_IMPORT_JOB_SOURCE}
      AND COALESCE("idempotencyKey", '') NOT LIKE ${`${SHOPIFY_IMPORT_JOB_IDEMPOTENCY_PREFIX}%`}
      ${
        input.excludeIds?.length
          ? Prisma.sql`AND "id" NOT IN (${Prisma.join(input.excludeIds)})`
          : Prisma.empty
      }
    ORDER BY "runAfter" ASC, "createdAt" ASC
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

async function runDueSyncJobGroup(
  shopJobs: DueSyncJobRunQueueItem[],
  results: DueSyncJobRunResult[],
  now: Date,
  deadlineAt: Date | undefined,
  deadlineState: { continuationNeeded: boolean },
) {
  const [nextJob, ...remainingJobs] = shopJobs;

  if (!nextJob) return;

  if (!shouldClaimRunnerJob({ deadlineAt, now: new Date() })) {
    deadlineState.continuationNeeded = true;
    results[nextJob.index] = {
      jobId: nextJob.job.id,
      status: "skipped" as const,
      type: nextJob.job.type,
    };
    return;
  }

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

  await runDueSyncJobGroup(
    remainingJobs,
    results,
    now,
    deadlineAt,
    deadlineState,
  );
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
      select: dueSyncJobSelect,
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
        select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
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

    const activeJob = await prisma.syncJob.findFirst({
      select: { id: true },
      where: {
        NOT: [
          {
            AND: [
              { type: SyncJobType.SYNC_INCREMENTAL },
              getFacetOnlyIncrementalSyncJobWhere(),
            ],
          },
        ],
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

async function enqueueFacetBackfillJobsIfNeeded(input: {
  now: Date;
  shopId: string;
}) {
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
        in: [
          SyncJobStatus.PENDING,
          SyncJobStatus.RETRYING,
          SyncJobStatus.RUNNING,
        ],
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
  const jobsToCreate = batches
    .map((batch, index) => ({ batch, batchIndex: index + 1 }))
    .filter((batch) => !existingBatchIndexes.has(batch.batchIndex))
    .slice(0, availableSlots);

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
  const recoveredJobSummaries: Prisma.JsonObject[] = [];

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
        message:
          "Job SyncBay RUNNING stantii recuperati dal runner.",
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

  const interruptedJob = await getInterruptedRunningSyncJobResult(job);
  if (interruptedJob) return interruptedJob;

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

  const interruptedJobBeforeProvider =
    await getInterruptedRunningSyncJobResult(job);
  if (interruptedJobBeforeProvider) return interruptedJobBeforeProvider;

  const [admin, previewResult, facetBaselinesByItemId] = await Promise.all([
    getShopifyAdminGraphqlClient(job.shop.shopDomain),
    getImportPreviewResultByItemIds(connection, ebayItemIds),
    getLatestFacetBaselinesByItemId({
      ebayItemIds,
      shopId: job.shopId,
    }),
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
    existingCatalogFieldPoliciesByItemId:
      getExistingCatalogFieldPoliciesByItemId(job.payload),
    facetBaselinesByItemId,
    hasDefaultLocation: Boolean(job.shop.defaultLocationGid),
    importProductStatusOverride: getImportProductStatus(job.payload),
    previewResult: filteredPreviewResult,
    reuseOnly: getBooleanFromPayload(job.payload, "reuseOnly"),
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

  const interruptedJob = await getInterruptedRunningSyncJobResult(job);
  if (interruptedJob) return interruptedJob;

  const openConflicts = await prisma.syncConflict.findMany({
    select: {
      field: true,
      id: true,
      lastSyncBayValue: true,
      mappingId: true,
      mapping: {
        select: {
          ebayItemId: true,
          id: true,
          shopifyProductGid: true,
          shopifyVariantGid: true,
          sku: true,
          status: true,
        },
      },
      shopifyValue: true,
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
  let reactivationConflictResolvedCount = 0;
  if (reactivationConflictMappingIds.length > 0) {
    const interruptedJobBeforeConflictUpdate =
      await getInterruptedRunningSyncJobResult(job);
    if (interruptedJobBeforeConflictUpdate) {
      return interruptedJobBeforeConflictUpdate;
    }

    reactivationConflictResolvedCount = (
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
    ).count;
  }

  const interruptedJobBeforeConflictProbe =
    await getInterruptedRunningSyncJobResult(job);
  if (interruptedJobBeforeConflictProbe) return interruptedJobBeforeConflictProbe;

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
  const alignedPriceConflicts = await resolveLiveAlignedPriceConflicts({
    conflicts: openConflicts,
    defaultLocationGid: job.shop.defaultLocationGid,
    job,
    shopDomain: job.shop.shopDomain,
  });
  const resolvedAlignedPriceConflictIds = new Set(
    alignedPriceConflicts.conflictIds,
  );
  const openConflictItemIds = new Set(
    openConflicts.flatMap((conflict) => {
      if (
        resolvedAlignedDescriptionConflictIds.has(conflict.id) ||
        resolvedAlignedPriceConflictIds.has(conflict.id)
      ) {
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
        alignedPriceConflictResolvedCount: alignedPriceConflicts.count,
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

  if (isFacetOnlySyncJobPayload(job.payload)) {
    return runFacetOnlyIncrementalSyncJob({
      alignedDescriptionConflictResolvedCount:
        alignedDescriptionConflicts.count,
      alignedPriceConflictResolvedCount: alignedPriceConflicts.count,
      job,
      openConflictSkippedCount: openConflictItemIds.size,
      reactivationConflictResolvedCount,
      requestedItemIds: ebayItemIds,
      syncableItemIds,
    });
  }

  if (isPricingOnlySyncJobPayload(job.payload)) {
    return runPricingOnlyIncrementalSyncJob({
      alignedDescriptionConflictResolvedCount:
        alignedDescriptionConflicts.count,
      alignedPriceConflictResolvedCount: alignedPriceConflicts.count,
      job,
      openConflictSkippedCount: openConflictItemIds.size,
      reactivationConflictResolvedCount,
      requestedItemIds: ebayItemIds,
      syncableItemIds,
    });
  }

  const interruptedJobBeforeProvider =
    await getInterruptedRunningSyncJobResult(job);
  if (interruptedJobBeforeProvider) return interruptedJobBeforeProvider;

  const [admin, previewResult, facetBaselinesByItemId] = await Promise.all([
    getShopifyAdminGraphqlClient(job.shop.shopDomain),
    getIncrementalPreviewResult(job, syncableItemIds),
    getLatestFacetBaselinesByItemId({
      ebayItemIds: syncableItemIds,
      shopId: job.shopId,
    }),
  ]);
  const filteredPreviewResult = filterPreviewResultByItemIds(
    previewResult,
    syncableItemIds,
  );
  const result = await createShopifyDraftProductsIfEnabled({
    admin,
    defaultLocationGid: job.shop.defaultLocationGid,
    facetBaselinesByItemId,
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
      alignedPriceConflictResolvedCount: alignedPriceConflicts.count,
      conflictSkippedCount: openConflictItemIds.size,
      reactivationConflictResolvedCount,
      requestedCount: ebayItemIds.length,
      syncedCount: syncableItemIds.length,
    },
    warnings: result.warnings ?? [],
  });
  await maybeMarkSellerEventsRunWatermarkSucceeded(job);
  await maybeMarkCatalogReconcileRunWatermarkSucceeded(job);

  return {
    jobId: job.id,
    status: "succeeded" as const,
    type: job.type,
  };
}

async function runPricingOnlyIncrementalSyncJob(input: {
  alignedDescriptionConflictResolvedCount: number;
  alignedPriceConflictResolvedCount: number;
  job: DueSyncJob;
  openConflictSkippedCount: number;
  reactivationConflictResolvedCount: number;
  requestedItemIds: string[];
  syncableItemIds: string[];
}) {
  const interruptedJobBeforeProvider =
    await getInterruptedRunningSyncJobResult(input.job);
  if (interruptedJobBeforeProvider) return interruptedJobBeforeProvider;

  const [admin, previewResult, pricingRule, mappings, snapshots] =
    await Promise.all([
    getShopifyAdminGraphqlClient(input.job.shop.shopDomain),
    getIncrementalPreviewResult(input.job, input.syncableItemIds),
    getPricingRuleForShopId(input.job.shopId),
    prisma.productMapping.findMany({
      select: {
        ebayItemId: true,
        id: true,
        shopifyProductGid: true,
        shopifyVariantGid: true,
        sku: true,
      },
      where: {
        ebayItemId: { in: input.syncableItemIds },
        marketplaceId: getEbayMarketplaceId(input.job.payload),
        shopId: input.job.shopId,
      },
    }),
    prisma.productSnapshot.findMany({
      orderBy: { capturedAt: "desc" },
      select: {
        capturedAt: true,
        currency: true,
        ebayItemId: true,
        payload: true,
        priceAmount: true,
        productStatus: true,
        quantity: true,
        sku: true,
        source: true,
        title: true,
      },
      where: {
        ebayItemId: { in: input.syncableItemIds },
        priceAmount: { not: null },
        shopId: input.job.shopId,
        source: {
          in: [ProductSnapshotSource.EBAY, ProductSnapshotSource.SYNCBAY],
        },
      },
    }),
  ]);
  const previewItemsById = new Map(
    filterPreviewResultByItemIds(
      previewResult,
      input.syncableItemIds,
    ).items.map((item) => [item.itemId, item]),
  );
  const mappingsByItemId = new Map(
    mappings.map((mapping) => [mapping.ebayItemId, mapping]),
  );
  const snapshotPricingSourcesByItemId = buildSnapshotPricingSourcesByItemId(
    snapshots.flatMap((snapshot) =>
      snapshot.ebayItemId
        ? [
            {
              capturedAt: snapshot.capturedAt,
              currency: snapshot.currency,
              ebayItemId: snapshot.ebayItemId,
              payload: snapshot.payload,
              priceAmount:
                snapshot.priceAmount === null
                  ? null
                  : Number(snapshot.priceAmount),
              productStatus: snapshot.productStatus,
              quantity: snapshot.quantity,
              sku: snapshot.sku,
              source: snapshot.source,
              title: snapshot.title,
            },
          ]
        : [],
    ),
  );
  const latestSyncBayPricingBaselinesByItemId =
    buildLatestSyncBayPricingBaselinesByItemId(snapshots);
  const synced: Prisma.JsonObject[] = [];
  const skipped: Prisma.JsonObject[] = [];
  const unchanged: Prisma.JsonObject[] = [];
  const syncBaySnapshots: Prisma.ProductSnapshotCreateManyInput[] = [];
  const now = new Date();

  for (const itemId of input.syncableItemIds) {
    const item = previewItemsById.get(itemId);
    const mapping = mappingsByItemId.get(itemId);
    const pricingSource =
      item === undefined
        ? snapshotPricingSourcesByItemId.get(itemId)
        : {
            currency: item.normalized.currency,
            priceAmount: item.normalized.priceAmount,
            productStatus: item.normalized.productStatus,
            quantity: item.normalized.quantity,
            sku: item.normalized.sku,
            source: "preview" as const,
            title: item.normalized.title,
          };

    if (
      !pricingSource ||
      !mapping?.shopifyProductGid ||
      !mapping.shopifyVariantGid
    ) {
      skipped.push({
        ebayItemId: itemId,
        reason: !pricingSource
          ? "pricing_source_missing"
          : "shopify_mapping_missing",
      });
      continue;
    }

    const pricing = calculateShopifyPricing({
      discountPercent: pricingRule.discountPercent,
      ebayPriceAmount: pricingSource.priceAmount,
      roundingMode: pricingRule.roundingMode,
    });
    const price = formatShopifyPrice(pricing.priceAmount);
    const compareAtPrice = formatShopifyPrice(pricing.compareAtPriceAmount);

    if (!price) {
      skipped.push({
        ebayItemId: itemId,
        reason: "ebay_price_missing",
      });
      continue;
    }

    if (
      !shouldWriteShopifyPricing({
        next: { compareAtPrice, price },
        previous: latestSyncBayPricingBaselinesByItemId.get(itemId) ?? null,
      })
    ) {
      unchanged.push({
        compareAtPrice,
        ebayItemId: itemId,
        price,
        reason: "unchanged_pricing",
        shopifyProductGid: mapping.shopifyProductGid,
        shopifyVariantGid: mapping.shopifyVariantGid,
      });
      continue;
    }

    const interruptedJobBeforePricingWrite =
      await getInterruptedRunningSyncJobResult(input.job);
    if (interruptedJobBeforePricingWrite) return interruptedJobBeforePricingWrite;

    const updateResult = await updateShopifyVariantPricingOnly(admin, {
      compareAtPrice,
      price,
      productGid: mapping.shopifyProductGid,
      variantGid: mapping.shopifyVariantGid,
    });

    if (updateResult.status === "failed") {
      throw new Error(updateResult.errorMessage);
    }

    synced.push({
      compareAtPrice: updateResult.compareAtPrice,
      ebayItemId: itemId,
      price: updateResult.price,
      shopifyProductGid: mapping.shopifyProductGid,
      shopifyVariantGid: mapping.shopifyVariantGid,
    });
    syncBaySnapshots.push({
      capturedAt: now,
      currency: pricingSource.currency,
      ebayItemId: itemId,
      mappingId: mapping.id,
      payload: {
        pricing: {
          applied: pricing.applied,
          compareAtPriceAmount: pricing.compareAtPriceAmount,
          discountPercent: pricing.discountPercent,
          ebayPriceAmount: pricingSource.priceAmount,
          priceAmount: pricing.priceAmount,
          pricingOnly: true,
          roundingMode: pricing.roundingMode,
        },
        pricingOnly: true,
        syncJobId: input.job.id,
      } satisfies Prisma.JsonObject,
      priceAmount: pricing.priceAmount,
      productStatus: pricingSource.productStatus ?? null,
      quantity: pricingSource.quantity ?? null,
      shopId: input.job.shopId,
      shopifyProductGid: mapping.shopifyProductGid,
      shopifyVariantGid: mapping.shopifyVariantGid,
      sku: pricingSource.sku ?? mapping.sku,
      source: ProductSnapshotSource.SYNCBAY,
      title: pricingSource.title,
    });
  }

  if (syncBaySnapshots.length > 0) {
    const syncedMappingIds = syncBaySnapshots
      .map((snapshot) => snapshot.mappingId)
      .filter((mappingId): mappingId is string => Boolean(mappingId));
    const changedSyncBaySnapshots =
      await filterChangedSyncBayProductSnapshots(syncBaySnapshots);

    await prisma.$transaction(async (tx) => {
      if (changedSyncBaySnapshots.length > 0) {
        await tx.productSnapshot.createMany({ data: changedSyncBaySnapshots });
      }

      await tx.productMapping.updateMany({
        data: { lastSyncedAt: now },
        where: { id: { in: syncedMappingIds } },
      });
    });
  }

  await markJobSucceeded({
    delegatedJobId: null,
    job: input.job,
    result: {
      alignedDescriptionConflictResolvedCount:
        input.alignedDescriptionConflictResolvedCount,
      alignedPriceConflictResolvedCount: input.alignedPriceConflictResolvedCount,
      conflictSkippedCount: input.openConflictSkippedCount,
      pricingOnly: true,
      reactivationConflictResolvedCount:
        input.reactivationConflictResolvedCount,
      requestedCount: input.requestedItemIds.length,
      skipped,
      skippedCount: skipped.length,
      synced,
      syncedCount: synced.length,
      unchanged,
      unchangedCount: unchanged.length,
    },
    warnings:
      skipped.length > 0
        ? [
            `Sync prezzo completato con ${skipped.length} prodotti saltati.`,
          ]
        : [],
  });
  await maybeMarkSellerEventsRunWatermarkSucceeded(input.job);
  await maybeMarkCatalogReconcileRunWatermarkSucceeded(input.job);

  return {
    jobId: input.job.id,
    status: "succeeded" as const,
    type: input.job.type,
  };
}

async function runFacetOnlyIncrementalSyncJob(input: {
  alignedDescriptionConflictResolvedCount: number;
  alignedPriceConflictResolvedCount: number;
  job: DueSyncJob;
  openConflictSkippedCount: number;
  reactivationConflictResolvedCount: number;
  requestedItemIds: string[];
  syncableItemIds: string[];
}) {
  const interruptedJobBeforeProvider =
    await getInterruptedRunningSyncJobResult(input.job);
  if (interruptedJobBeforeProvider) return interruptedJobBeforeProvider;

  const [admin, mappings, ebaySnapshots, facetBaselinesByItemId] =
    await Promise.all([
      getShopifyAdminGraphqlClient(input.job.shop.shopDomain),
      prisma.productMapping.findMany({
        select: {
          ebayItemId: true,
          id: true,
          shopifyProductGid: true,
        },
        where: {
          ebayItemId: { in: input.syncableItemIds },
          marketplaceId: getEbayMarketplaceId(input.job.payload),
          shopId: input.job.shopId,
          status: ProductMappingStatus.ACTIVE,
        },
      }),
      prisma.productSnapshot.findMany({
        orderBy: { capturedAt: "desc" },
        select: {
          ebayItemId: true,
          payload: true,
          title: true,
        },
        where: {
          ebayItemId: { in: input.syncableItemIds },
          shopId: input.job.shopId,
          source: ProductSnapshotSource.EBAY,
        },
      }),
      getLatestFacetBaselinesByItemId({
        ebayItemIds: input.syncableItemIds,
        shopId: input.job.shopId,
      }),
    ]);
  const mappingsByItemId = new Map(
    mappings.map((mapping) => [mapping.ebayItemId, mapping]),
  );
  const latestEbaySnapshotByItemId = new Map<
    string,
    { payload: Prisma.JsonValue | null; title: string | null }
  >();

  for (const snapshot of ebaySnapshots) {
    if (
      !snapshot.ebayItemId ||
      latestEbaySnapshotByItemId.has(snapshot.ebayItemId)
    ) {
      continue;
    }

    latestEbaySnapshotByItemId.set(snapshot.ebayItemId, {
      payload: snapshot.payload,
      title: snapshot.title,
    });
  }

  let facetConflictCount = 0;
  let facetDeletedCount = 0;
  let facetSkippedCount = 0;
  let facetWrittenCount = 0;
  const synced: Prisma.JsonObject[] = [];
  const skipped: Prisma.JsonObject[] = [];
  const syncBaySnapshots: Prisma.ProductSnapshotCreateManyInput[] = [];
  const now = new Date();

  for (const itemId of input.syncableItemIds) {
    const interruptedJobBeforeFacetWrite =
      await getInterruptedRunningSyncJobResult(input.job);
    if (interruptedJobBeforeFacetWrite) return interruptedJobBeforeFacetWrite;

    const mapping = mappingsByItemId.get(itemId);

    if (!mapping?.shopifyProductGid) {
      skipped.push({
        ebayItemId: itemId,
        reason: "shopify_mapping_missing",
      });
      continue;
    }

    const ebaySnapshot = latestEbaySnapshotByItemId.get(itemId);
    if (!ebaySnapshot) {
      skipped.push({
        ebayItemId: itemId,
        reason: "ebay_snapshot_missing",
      });
      continue;
    }

    const payload = getJsonObject(ebaySnapshot.payload);
    const proposedFacets = buildSyncBayProductFacetProposalFromSnapshot({
      ebayPrimaryCategoryName: getNullableStringFromRecord(
        payload,
        "ebayPrimaryCategoryName",
      ),
      payload,
      storeCategoryName: getNullableStringFromRecord(
        payload,
        "storeCategoryName",
      ),
      title: ebaySnapshot.title,
    });
    const previousSyncBayFacets = facetBaselinesByItemId[itemId] ?? [];

    if (proposedFacets.length === 0 && previousSyncBayFacets.length === 0) {
      skipped.push({
        ebayItemId: itemId,
        reason: "no_high_confidence_facets",
      });
      continue;
    }

    const facetSync = await syncShopifyProductFacets({
      admin,
      ownerId: mapping.shopifyProductGid,
      previousSyncBayFacets,
      proposedFacets,
    });

    if (facetSync.status === "missing_owner") {
      skipped.push({
        ebayItemId: itemId,
        reason: "shopify_product_missing",
        shopifyProductGid: mapping.shopifyProductGid,
      });
      continue;
    }

    facetConflictCount += facetSync.conflicts.length;
    facetDeletedCount += facetSync.deleted.length;
    facetSkippedCount += facetSync.skipped.length;
    facetWrittenCount += facetSync.written.length;
    synced.push({
      conflictCount: facetSync.conflicts.length,
      deletedCount: facetSync.deleted.length,
      ebayItemId: itemId,
      proposedCount: proposedFacets.length,
      shopifyProductGid: mapping.shopifyProductGid,
      skippedCount: facetSync.skipped.length,
      writtenCount: facetSync.written.length,
    });

    const shouldPersistFacetBaseline =
      facetSync.written.length > 0 ||
      facetSync.deleted.length > 0 ||
      hasSyncBayProductFacetBaselineChanged(
        previousSyncBayFacets,
        facetSync.baselineFacets,
      );

    if (shouldPersistFacetBaseline) {
      syncBaySnapshots.push({
        capturedAt: now,
        ebayItemId: itemId,
        mappingId: mapping.id,
        payload: buildProductFacetBaselineSnapshotPayload({
          facetSync,
          jobId: input.job.id,
        }),
        shopId: input.job.shopId,
        shopifyProductGid: mapping.shopifyProductGid,
        source: ProductSnapshotSource.SYNCBAY,
        title: ebaySnapshot.title,
      });
    }
  }

  if (syncBaySnapshots.length > 0) {
    const syncedMappingIds = syncBaySnapshots
      .map((snapshot) => snapshot.mappingId)
      .filter((mappingId): mappingId is string => Boolean(mappingId));
    const changedSyncBaySnapshots =
      await filterChangedSyncBayProductSnapshots(syncBaySnapshots);

    await prisma.$transaction(async (tx) => {
      if (changedSyncBaySnapshots.length > 0) {
        await tx.productSnapshot.createMany({ data: changedSyncBaySnapshots });
      }

      await tx.productMapping.updateMany({
        data: { lastSyncedAt: now },
        where: { id: { in: syncedMappingIds } },
      });
    });
  }

  await markJobSucceeded({
    delegatedJobId: null,
    job: input.job,
    result: {
      alignedDescriptionConflictResolvedCount:
        input.alignedDescriptionConflictResolvedCount,
      alignedPriceConflictResolvedCount: input.alignedPriceConflictResolvedCount,
      conflictSkippedCount: input.openConflictSkippedCount,
      facetConflictCount,
      facetDeletedCount,
      facetOnly: true,
      facetSkippedCount,
      facetWrittenCount,
      reactivationConflictResolvedCount: input.reactivationConflictResolvedCount,
      requestedCount: input.requestedItemIds.length,
      skipped,
      skippedCount: skipped.length,
      source: getStringFromPayload(input.job.payload, "source") ?? "facet_only",
      synced,
      syncedCount: synced.length,
    },
    warnings: buildFacetOnlyWarnings({ skipped, synced }),
  });
  await maybeMarkFacetBackfillRunSucceeded(input.job);

  return {
    jobId: input.job.id,
    status: "succeeded" as const,
    type: input.job.type,
  };
}

type SyncBayPricingBaselineSnapshot = {
  capturedAt: Date;
  ebayItemId: string | null;
  payload: Prisma.JsonValue | null;
  priceAmount: Prisma.Decimal | null;
  source: ProductSnapshotSource;
};

type SyncBayFacetSyncResult = Awaited<
  ReturnType<typeof syncShopifyProductFacets>
>;

async function getLatestFacetBaselinesByItemId(input: {
  ebayItemIds: string[];
  shopId: string;
}): Promise<Record<string, SyncBayProductFacet[]>> {
  if (input.ebayItemIds.length === 0) return {};

  const snapshots = await prisma.productSnapshot.findMany({
    orderBy: { capturedAt: "desc" },
    select: {
      ebayItemId: true,
      payload: true,
    },
    where: {
      ebayItemId: { in: input.ebayItemIds },
      shopId: input.shopId,
      source: {
        in: [ProductSnapshotSource.SYNCBAY, ProductSnapshotSource.EBAY],
      },
    },
  });
  const baselines: Record<string, SyncBayProductFacet[]> = {};

  for (const snapshot of snapshots) {
    if (!snapshot.ebayItemId || Object.hasOwn(baselines, snapshot.ebayItemId)) {
      continue;
    }

    const baseline = getProductFacetBaselineFromSnapshotPayload(
      snapshot.payload,
    );
    if (baseline === null) continue;

    baselines[snapshot.ebayItemId] = baseline;
  }

  return baselines;
}

function buildProductFacetBaselineSnapshotPayload(input: {
  facetSync: SyncBayFacetSyncResult;
  jobId: string;
}) {
  return {
    facetOnly: true,
    facetSync: {
      conflictKeys: input.facetSync.conflicts.map((facet) => facet.key),
      deletedKeys: input.facetSync.deleted.map((facet) => facet.key),
      skippedKeys: input.facetSync.skipped.map((facet) => facet.key),
      status: input.facetSync.status,
      writtenKeys: input.facetSync.written.map((facet) => facet.key),
    },
    productFacets: input.facetSync.baselineFacets.map(serializeProductFacet),
    syncJobId: input.jobId,
  } satisfies Prisma.JsonObject;
}

function serializeProductFacet(facet: SyncBayProductFacet) {
  return {
    key: facet.key,
    label: facet.label,
    namespace: facet.namespace,
    type: facet.type,
    value: facet.value,
  };
}

function buildFacetOnlyWarnings(input: {
  skipped: Prisma.JsonObject[];
  synced: Prisma.JsonObject[];
}) {
  const warnings: string[] = [];
  const conflictCount = input.synced.reduce(
    (total, row) => total + (getJsonNumber(row.conflictCount) ?? 0),
    0,
  );

  if (input.skipped.length > 0) {
    warnings.push(
      `Backfill faccette completato con ${input.skipped.length} prodotti saltati.`,
    );
  }

  if (conflictCount > 0) {
    warnings.push(
      `Faccette Shopify non sovrascritte su ${conflictCount} campi modificati manualmente.`,
    );
  }

  return warnings;
}

function buildLatestSyncBayPricingBaselinesByItemId(
  snapshots: SyncBayPricingBaselineSnapshot[],
) {
  const baselines = new Map<string, SyncBayPricingWriteBaseline>();
  const sortedSnapshots = [...snapshots].sort(
    (left, right) => right.capturedAt.getTime() - left.capturedAt.getTime(),
  );

  for (const snapshot of sortedSnapshots) {
    if (
      snapshot.source !== ProductSnapshotSource.SYNCBAY ||
      !snapshot.ebayItemId ||
      baselines.has(snapshot.ebayItemId)
    ) {
      continue;
    }

    const priceAmount =
      getPricingPayloadMoneyAmount(snapshot.payload, "priceAmount") ??
      getSnapshotPriceAmountForPricingWriteBaseline(snapshot);

    if (priceAmount === null) continue;

    baselines.set(snapshot.ebayItemId, {
      compareAtPriceAmount: getPricingPayloadMoneyAmount(
        snapshot.payload,
        "compareAtPriceAmount",
      ),
      priceAmount,
    });
  }

  return baselines;
}

function getSnapshotPriceAmountForPricingWriteBaseline(
  snapshot: SyncBayPricingBaselineSnapshot,
) {
  if (snapshot.priceAmount === null) return null;

  const priceAmount = Number(snapshot.priceAmount);

  return Number.isFinite(priceAmount) ? priceAmount.toFixed(2) : null;
}

async function updateShopifyVariantPricingOnly(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  input: {
    compareAtPrice: string | null;
    price: string;
    productGid: string;
    variantGid: string;
  },
): Promise<
  | {
      compareAtPrice: string | null;
      price: string | null;
      status: "synced";
    }
  | {
      errorMessage: string;
      status: "failed";
    }
> {
  const response = await admin.graphql(
    `#graphql
    mutation SyncBayUpdateVariantPricingOnly($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          price
          compareAtPrice
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        productId: input.productGid,
        variants: [
          {
            compareAtPrice: input.compareAtPrice,
            id: input.variantGid,
            price: input.price,
          },
        ],
      },
    },
  );
  const json =
    (await response.json()) as ShopifyPricingVariantUpdateResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify productVariantsBulkUpdate ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyGraphqlErrors(json.errors),
      status: "failed",
    };
  }

  const userErrors = json.data?.productVariantsBulkUpdate?.userErrors ?? [];

  if (userErrors.length > 0) {
    return {
      errorMessage: formatShopifyUserErrors(userErrors),
      status: "failed",
    };
  }

  const updatedVariant =
    json.data?.productVariantsBulkUpdate?.productVariants?.[0] ?? null;

  if (!updatedVariant) {
    return {
      errorMessage: "Shopify non ha restituito la variante aggiornata.",
      status: "failed",
    };
  }

  return {
    compareAtPrice: updatedVariant.compareAtPrice ?? null,
    price: updatedVariant.price ?? null,
    status: "synced",
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
  let resolvedQuantityConflictCount = 0;
  const quantityConflictCleanupFailures: Prisma.JsonObject[] = [];
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

    const latestStockSnapshots = await prisma.productSnapshot.findMany({
      orderBy: { capturedAt: "desc" },
      take: 1,
      where: {
        currency: { not: null },
        mappingId: mapping.id,
        quantity: { not: null },
      },
    });
    const latestSnapshot =
      selectLatestStockBaselineSnapshot(latestStockSnapshots);
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

    const interruptedJobBeforeTokenLookup =
      await getInterruptedRunningSyncJobResult(job);
    if (interruptedJobBeforeTokenLookup) return interruptedJobBeforeTokenLookup;

    accessToken ??= (await getUsableEbayAccessToken(connection)).accessToken;

    if (!accessToken) {
      throw new Error("Token eBay non disponibile per aggiornare lo stock.");
    }

    const interruptedJobBeforeEbayWrite =
      await getInterruptedRunningSyncJobResult(job);
    if (interruptedJobBeforeEbayWrite) return interruptedJobBeforeEbayWrite;

    await reviseEbayTradingInventoryQuantity({
      accessToken,
      connection,
      itemId: mapping.ebayItemId,
      quantity: nextQuantity,
      sku: mapping.sku,
      skuGenerated: getSnapshotSkuGenerated(latestSkuPolicySnapshot?.payload),
    });
    const stockSnapshot = {
      ebayItemId: mapping.ebayItemId,
      mappingId: mapping.id,
      payload: {
        ...getSnapshotPricingPayloadObject(latestSnapshot?.payload),
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
    } satisfies Prisma.ProductSnapshotCreateManyInput;
    // Questo snapshot è anche il marker durevole di idempotenza dopo la write eBay.
    await prisma.productSnapshot.create({ data: stockSnapshot });
    let resolvedQuantityConflicts = 0;
    let resolvedQuantityConflictCleanupError: string | undefined;
    try {
      resolvedQuantityConflicts = await resolveOrderStockQuantityConflicts({
        defaultLocationGid: job.shop.defaultLocationGid,
        mappingId: mapping.id,
        mappingStatus: mapping.status,
        nextQuantity,
        shopDomain: job.shop.shopDomain,
        shopId: job.shopId,
        shopifyProductGid: mapping.shopifyProductGid,
        shopifyVariantGid: mapping.shopifyVariantGid,
      });
    } catch (error) {
      resolvedQuantityConflictCleanupError = getErrorMessage(error);
      quantityConflictCleanupFailures.push({
        ebayItemId: mapping.ebayItemId,
        errorMessage: resolvedQuantityConflictCleanupError,
        lineItemKey: lineItem.lineItemKey,
      });
    }
    resolvedQuantityConflictCount += resolvedQuantityConflicts;
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
      resolvedQuantityConflictCleanupError,
      resolvedQuantityConflicts,
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
      quantityConflictCleanupFailures,
      quantityConflictCleanupFailureCount: quantityConflictCleanupFailures.length,
      resolvedQuantityConflictCount,
      skipped,
      skippedCount: skipped.length,
      updated,
      updatedCount: updated.length,
    },
    warnings: [
      ...(skipped.length > 0
        ? ["Alcune righe ordine non sono state applicate a eBay."]
        : []),
      ...(quantityConflictCleanupFailures.length > 0
        ? [
            "Alcune pulizie dei conflitti quantità non sono state completate dopo la write eBay.",
          ]
        : []),
    ],
  });

  return {
    jobId: job.id,
    status: "succeeded" as const,
    type: job.type,
  };
}

type LatestSyncBayProductSnapshotForDedupe = {
  currency: string | null;
  descriptionHash: string | null;
  ebayItemId: string | null;
  imageCount: number | null;
  mappingId: string | null;
  payload: Prisma.JsonValue | null;
  priceAmount: Prisma.Decimal | null;
  productStatus: string | null;
  quantity: number | null;
  shopifyProductGid: string | null;
  shopifyVariantGid: string | null;
  sku: string | null;
  source: ProductSnapshotSource;
  title: string | null;
};

async function filterChangedSyncBayProductSnapshots(
  snapshots: Prisma.ProductSnapshotCreateManyInput[],
) {
  const mappingIds = [
    ...new Set(
      snapshots
        .map((snapshot) => snapshot.mappingId)
        .filter((mappingId): mappingId is string => Boolean(mappingId)),
    ),
  ];

  if (mappingIds.length === 0) return snapshots;

  const previousSnapshots =
    await prisma.$queryRaw<LatestSyncBayProductSnapshotForDedupe[]>`
      SELECT DISTINCT ON ("mappingId")
        "currency",
        "descriptionHash",
        "ebayItemId",
        "imageCount",
        "mappingId",
        "payload",
        "priceAmount",
        "productStatus",
        "quantity",
        "shopifyProductGid",
        "shopifyVariantGid",
        "sku",
        "source",
        "title"
      FROM "ProductSnapshot"
      WHERE
        "mappingId" IN (${Prisma.join(mappingIds)})
        AND "source" = 'SYNCBAY'::"ProductSnapshotSource"
      ORDER BY "mappingId", "capturedAt" DESC
    `;
  const previousSnapshotByMappingId = new Map(
    previousSnapshots.flatMap((snapshot) =>
      snapshot.mappingId ? [[snapshot.mappingId, snapshot]] : [],
    ),
  );

  return snapshots.filter((snapshot) =>
    shouldCreateProductSnapshot({
      next: snapshot,
      previous: snapshot.mappingId
        ? previousSnapshotByMappingId.get(snapshot.mappingId)
        : null,
    }),
  );
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
    await maybeMarkCatalogReconcileRunWatermarkSucceeded(job);

    return {
      jobId: job.id,
      status: "succeeded" as const,
      type: job.type,
    };
  }

  const soldOutWarnings: string[] = [];
  const interruptedJob = await getInterruptedRunningSyncJobResult(job);
  if (interruptedJob) return interruptedJob;

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

  const soldOutSnapshot = {
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
  } satisfies Prisma.ProductSnapshotCreateManyInput;
  const changedSoldOutSnapshots =
    await filterChangedSyncBayProductSnapshots([soldOutSnapshot]);
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
    changedSoldOutSnapshots.length > 0
      ? prisma.productSnapshot.create({ data: soldOutSnapshot })
      : prisma.syncJob.count({ where: { id: job.id } }),
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
  await maybeMarkCatalogReconcileRunWatermarkSucceeded(job);

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

async function maybeMarkCatalogReconcileRunWatermarkSucceeded(job: DueSyncJob) {
  const source = getStringFromPayload(job.payload, "source");
  const runId = getStringFromPayload(job.payload, "runId");
  const marketplaceId = getEbayMarketplaceId(job.payload);

  if (source !== "catalog_reconcile" || !runId) return;

  const runJobs = await prisma.syncJob.findMany({
    select: { status: true },
    where: {
      AND: [
        { payload: { path: ["source"], equals: "catalog_reconcile" } },
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
    !shouldAdvanceCatalogReconcileRunWatermark({
      statuses: runJobs.map((runJob) => runJob.status),
    })
  ) {
    return;
  }

  const payloadObject = getJsonObject(job.payload);
  const finishedAt = new Date();
  const processedJobCount = runJobs.length;
  const activeCatalogReadAt = getStringFromPayload(
    job.payload,
    "activeCatalogReadAt",
  );
  const activeCatalogReadCount = getJsonNumber(
    payloadObject?.activeCatalogReadCount,
  );
  const activeCatalogTotalAvailable =
    getJsonNumber(payloadObject?.activeCatalogTotalAvailable) ?? null;
  const activeScanComplete = getBooleanFromPayload(
    job.payload,
    "activeScanComplete",
  );
  const markerPayload = {
    activeCatalogReadAt,
    activeCatalogReadCount,
    activeCatalogTotalAvailable,
    activeScanComplete,
    marketplaceId,
    processedJobCount,
    runId,
    source: "catalog_reconcile",
    watermarkAdvanced: true,
  } satisfies Prisma.JsonObject;

  await prisma.syncJob.createMany({
    data: [
      {
        attempts: 1,
        finishedAt,
        idempotencyKey: `catalog-reconcile-watermark:${job.shopId}:${marketplaceId}:${runId}`,
        maxAttempts: 1,
        payload: markerPayload,
        result: markerPayload,
        runAfter: finishedAt,
        shopId: job.shopId,
        status: SyncJobStatus.SUCCEEDED,
        type: SyncJobType.SYNC_INCREMENTAL,
      },
    ],
    skipDuplicates: true,
  });
}

async function maybeMarkFacetBackfillRunSucceeded(job: DueSyncJob) {
  const source = getStringFromPayload(job.payload, "source");
  const runId = getStringFromPayload(job.payload, "facetBackfillRunId");
  const marketplaceId = getEbayMarketplaceId(job.payload);
  const payloadObject = getJsonObject(job.payload);
  const version = getJsonNumber(payloadObject?.facetBackfillVersion);
  const expectedBatchCount = getJsonNumber(payloadObject?.batchCount);

  if (
    source !== "facet_backfill" ||
    !runId ||
    version === null ||
    expectedBatchCount === null
  ) {
    return;
  }

  const runJobs = await prisma.syncJob.findMany({
    select: { status: true },
    where: {
      AND: [
        { payload: { path: ["source"], equals: "facet_backfill" } },
        { payload: { path: ["facetBackfillRunId"], equals: runId } },
      ],
      shopId: job.shopId,
      type: SyncJobType.SYNC_INCREMENTAL,
    },
  });

  if (
    runJobs.length < expectedBatchCount ||
    runJobs.some((runJob) => runJob.status !== SyncJobStatus.SUCCEEDED)
  ) {
    return;
  }

  const finishedAt = new Date();
  const markerPayload = {
    facetBackfillRunId: runId,
    facetBackfillVersion: version,
    marketplaceId,
    processedJobCount: runJobs.length,
    source: "facet_backfill_marker",
  } satisfies Prisma.JsonObject;

  await prisma.syncJob.createMany({
    data: [
      {
        attempts: 1,
        finishedAt,
        idempotencyKey: `facet-backfill-marker:${job.shopId}:${marketplaceId}:v${version}:${runId}`,
        maxAttempts: 1,
        payload: markerPayload,
        result: markerPayload,
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
  const queued = await prisma.syncJob.findMany({
    orderBy: [{ createdAt: "asc" }],
    select: dueSyncJobSelect,
    take: 49,
    where: {
      id: { not: job.id },
      runAfter: { lte: new Date() },
      shopId: job.shopId,
      status: { in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING] },
      type: SyncJobType.DETECT_SHOPIFY_CHANGES,
    },
  });
  const candidates = [job, ...queued];
  const batch = buildShopifyChangeBatch(candidates.map(toShopifyChangeBatchJob));
  const selectedIds = new Set([
    ...batch.jobs.map(({ id }) => id),
    ...batch.duplicateJobIds,
  ]);
  const siblingIds = [...selectedIds].filter((id) => id !== job.id);
  if (siblingIds.length > 0) {
    await prisma.syncJob.updateMany({
      data: { startedAt: new Date(), status: SyncJobStatus.RUNNING },
      where: {
        id: { in: siblingIds },
        status: { in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING] },
      },
    });
  }
  const absorbedJobs = await prisma.syncJob.findMany({
    select: dueSyncJobSelect,
    where: { id: { in: [...selectedIds] }, status: SyncJobStatus.RUNNING },
  });
  const absorbedById = new Map(absorbedJobs.map((entry) => [entry.id, entry]));

  if (batch.duplicateJobIds.length > 0) {
    await prisma.syncJob.updateMany({
      data: {
        finishedAt: new Date(),
        result: { reason: "superseded_by_newer_queued_webhook" },
        status: SyncJobStatus.CANCELLED,
      },
      where: { id: { in: batch.duplicateJobIds }, status: SyncJobStatus.RUNNING },
    });
  }

  const distinctJobs = batch.jobs.filter(({ id }) => absorbedById.has(id));
  const execution = await detectShopifyChangesBatch(
    { jobs: distinctJobs, shopDomain: job.shop.shopDomain },
  );

  for (const result of execution.results) {
    const absorbedJob = absorbedById.get(result.jobId);
    if (!absorbedJob) continue;
    if (result.outcome === "failed") {
      await markJobFailedOrRetrying({
        errorCode: result.errorCode ?? "SHOPIFY_CONFLICT_BATCH_FAILED",
        errorMessage: "Rilevamento conflitti Shopify non completato.",
        job: absorbedJob,
      });
      continue;
    }
    await markJobSucceeded({
      delegatedJobId: null,
      job: absorbedJob,
      result: {
        fields: result.fields,
        outcome: result.outcome,
        providerReadCount: execution.providerReadCount,
      },
      warnings: result.outcome === "mapping_not_found"
        ? ["Webhook Shopify senza mapping SyncBay collegato."]
        : [],
    });
  }

  const conflictCount = execution.results.filter(
    ({ outcome }) => outcome === "conflict_opened",
  ).length;
  const mappingNotFoundCount = execution.results.filter(
    ({ outcome }) => outcome === "mapping_not_found",
  ).length;
  const seedResult = execution.results.find(({ jobId }) => jobId === job.id);
  return {
    ...(seedResult?.outcome === "failed"
      ? { errorMessage: "Rilevamento conflitti Shopify non completato." }
      : {}),
    jobId: job.id,
    status: batch.duplicateJobIds.includes(job.id)
      ? ("skipped" as const)
      : seedResult?.outcome === "failed"
        ? ("failed" as const)
        : ("succeeded" as const),
    type: job.type,
    absorbedJobCount: absorbedJobs.length,
    conflictCount,
    mappingNotFoundCount,
    providerReadCount: execution.providerReadCount,
  } as DueSyncJobRunResult;
}

function toShopifyChangeBatchJob(job: DueSyncJob): ShopifyChangeBatchJob {
  return {
    createdAt: job.createdAt,
    id: job.id,
    inventoryItemGid: getStringFromPayload(job.payload, "inventoryItemGid"),
    productGid: getStringFromPayload(job.payload, "resourceId"),
    shopId: job.shopId,
    topic: getStringFromPayload(job.payload, "topic") ?? "unknown",
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    findLatestSyncBayImageSnapshot(mappingId),
    findLatestSyncBayPriceSnapshot(mappingId),
    findLatestSyncBayStatusSnapshot(mappingId),
    findLatestSyncBayQuantitySnapshot(mappingId),
    findLatestSyncBayTitleSnapshot(mappingId),
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
    compareAtPriceAmount: getPricingPayloadMoneyAmount(
      priceSnapshot?.payload,
      "compareAtPriceAmount",
    ),
    descriptionHash: descriptionSnapshot?.descriptionHash ?? null,
    imageCount: imageSnapshot?.imageCount ?? null,
    priceAmount: priceSnapshot?.priceAmount ?? null,
    productStatus: statusSnapshot?.productStatus ?? null,
    quantity: quantitySnapshot?.quantity ?? null,
    shopifyVariantGid:
      priceSnapshot?.shopifyVariantGid ??
      quantitySnapshot?.shopifyVariantGid ??
      null,
    title: titleSnapshot?.title ?? null,
  };
}

async function findLatestSyncBayImageSnapshot(mappingId: string) {
  return prisma.productSnapshot.findFirst({
    orderBy: { capturedAt: "desc" },
    select: { imageCount: true },
    where: {
      imageCount: { not: null },
      mappingId,
      source: ProductSnapshotSource.SYNCBAY,
    },
  });
}

async function findLatestSyncBayPriceSnapshot(mappingId: string) {
  return prisma.productSnapshot.findFirst({
    orderBy: { capturedAt: "desc" },
    select: { payload: true, priceAmount: true, shopifyVariantGid: true },
    where: {
      mappingId,
      priceAmount: { not: null },
      source: ProductSnapshotSource.SYNCBAY,
    },
  });
}

async function findLatestSyncBayStatusSnapshot(mappingId: string) {
  return prisma.productSnapshot.findFirst({
    orderBy: { capturedAt: "desc" },
    select: { productStatus: true },
    where: {
      mappingId,
      productStatus: { not: null },
      source: ProductSnapshotSource.SYNCBAY,
    },
  });
}

async function findLatestSyncBayQuantitySnapshot(mappingId: string) {
  return prisma.productSnapshot.findFirst({
    orderBy: { capturedAt: "desc" },
    select: { quantity: true, shopifyVariantGid: true },
    where: {
      mappingId,
      quantity: { not: null },
      source: ProductSnapshotSource.SYNCBAY,
    },
  });
}

async function findLatestSyncBayTitleSnapshot(mappingId: string) {
  return prisma.productSnapshot.findFirst({
    orderBy: { capturedAt: "desc" },
    select: { title: true },
    where: {
      mappingId,
      source: ProductSnapshotSource.SYNCBAY,
      title: { not: null },
    },
  });
}

function getPricingPayloadMoneyAmount(
  payload: Prisma.JsonValue | null | undefined,
  key: "compareAtPriceAmount" | "priceAmount",
) {
  const object = getJsonObject(payload);
  const pricing = getJsonObject(object?.pricing);
  const value = pricing?.[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }

  if (typeof value === "string" && value.trim()) {
    const number = Number(value);

    return Number.isFinite(number) ? number.toFixed(2) : value.trim();
  }

  return null;
}

function getSnapshotPricingPayloadObject(
  payload: Prisma.JsonValue | null | undefined,
) {
  const pricing = getJsonObject(getJsonObject(payload)?.pricing);

  return pricing ? ({ pricing } satisfies Prisma.JsonObject) : {};
}

async function findLatestSyncBayDescriptionBaseline(mappingId: string) {
  const rows = await prisma.$queryRaw<{ descriptionHash: string | null }[]>`
    SELECT "descriptionHash"
    FROM "ProductSnapshot"
    WHERE
      "mappingId" = ${mappingId}
      AND "source" = 'SYNCBAY'::"ProductSnapshotSource"
      AND "descriptionHash" IS NOT NULL
      AND ${SYNCBAY_DESCRIPTION_BASELINE_PAYLOAD_SQL}
    ORDER BY "capturedAt" DESC
    LIMIT 1
  `;

  return rows[0] ?? null;
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

async function getInterruptedRunningSyncJobResult(
  job: DueSyncJob,
): Promise<DueSyncJobRunResult | null> {
  const currentJob = await prisma.syncJob.findUnique({
    select: { status: true },
    where: { id: job.id },
  });

  if (shouldContinueRunningSyncJob(currentJob?.status ?? null)) return null;

  return {
    errorMessage:
      "Job SyncBay interrotto: lo stato non è più RUNNING prima del lavoro provider.",
    jobId: job.id,
    status: "skipped",
    type: job.type,
  };
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
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
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
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
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
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
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

function getExistingCatalogFieldPoliciesByItemId(
  payload: Prisma.JsonValue | null,
) {
  return parseExistingCatalogFieldPoliciesByItemId(
    getJsonObject(payload)?.existingCatalogFieldPoliciesByItemId,
  );
}

function isFacetOnlySyncJobPayload(payload: Prisma.JsonValue | null) {
  const source = getStringFromPayload(payload, "source");

  return (
    getBooleanFromPayload(payload, "facetOnly") ||
    source === "facet_backfill"
  );
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

    if (
      !lineItemObject ||
      !quantity ||
      !isPositiveShopifyOrderQuantity(quantity)
    ) {
      return [];
    }

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function findMappingByInventoryItemGid(
  shopId: string,
  inventoryItemGid: string,
) {
  return prisma.productMapping.findUnique({
    where: {
      shopId_shopifyInventoryItemGid: {
        shopId,
        shopifyInventoryItemGid: inventoryItemGid,
      },
    },
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
  options: { preferredVariantGid?: string | null } = {},
) {
  const preferredVariantGid = options.preferredVariantGid?.trim() ?? "";
  const locationVariable = defaultLocationGid ? ", $locationId: ID!" : "";
  const variantVariable = preferredVariantGid ? ", $variantId: ID!" : "";
  const inventoryLevelSelection = defaultLocationGid
    ? `inventoryLevel(locationId: $locationId) {
                  quantities(names: ["available"]) {
                    name
                    quantity
                  }
                }`
    : "";
  const variantSelection = `
              id
              inventoryQuantity
              price
              compareAtPrice
              inventoryItem {
                tracked
                ${inventoryLevelSelection}
              }`;
  const mappedVariantSelection = preferredVariantGid
    ? `
      variantNode: node(id: $variantId) {
        ... on ProductVariant {
          ${variantSelection}
          product {
            id
          }
        }
      }`
    : "";
  const query = `#graphql
    query SyncBayProductForConflict($id: ID!${locationVariable}${variantVariable}) {
      productNode: node(id: $id) {
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
          ${variantSelection}
            }
          }
        }
      }
      ${mappedVariantSelection}
    }`;
  const variables: Record<string, unknown> = { id: productGid };

  if (defaultLocationGid) variables.locationId = defaultLocationGid;
  if (preferredVariantGid) variables.variantId = preferredVariantGid;

  const response = await admin.graphql(query, { variables });

  if (!response.ok) return null;

  const json = (await response.json()) as ShopifyProductForConflictResponse;

  if (json.errors?.length) return null;

  const product = json.data?.productNode ?? null;

  if (!product) return null;

  const preferredVariant =
    json.data?.variantNode?.product?.id === product.id
      ? json.data.variantNode
      : null;

  return {
    ...product,
    variants: {
      ...(product.variants ?? {}),
      nodes: mergePreferredShopifyVariantForSync({
        preferredVariant,
        variants: product.variants?.nodes,
      }),
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getDetectedShopifyConflicts(
  product: ShopifyProductForConflict,
  snapshot: {
    compareAtPriceAmount: string | null;
    descriptionHash: string | null;
    imageCount: number | null;
    priceAmount: Prisma.Decimal | null;
    productStatus: string | null;
    quantity: number | null;
    shopifyVariantGid: string | null;
    title: string | null;
  },
  hasManagedLocation: boolean,
  preferredVariantGid?: string | null,
) {
  const variant = selectShopifyVariantForSync({
    preferredVariantGid,
    variants: product.variants?.nodes,
  });
  const shopifyQuantity = getLiveShopifyQuantityForConflict(
    product,
    hasManagedLocation,
    preferredVariantGid,
  );
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
  const shopifyDescriptionHash = hashNullableText(
    product.descriptionHtml ?? null,
  );
  const descriptionConflict = shouldSkipDescriptionConflictWhenEbayHasNoDescription(
    {
      shopifyDescriptionHash,
      syncBayDescriptionHash: snapshot.descriptionHash,
    },
  )
    ? null
    : buildConflict(
        "description",
        snapshot.descriptionHash,
        shopifyDescriptionHash,
      );
  const fields = [
    buildConflict("title", snapshot.title, product.title),
    descriptionConflict,
    buildConflict("status", snapshot.productStatus, product.status),
    buildPriceConflict({
      lastCompareAtPrice: snapshot.compareAtPriceAmount,
      lastPrice: snapshot.priceAmount?.toFixed(2) ?? null,
      shopifyCompareAtPrice: variant?.compareAtPrice ?? null,
      shopifyPrice: variant?.price ?? null,
    }),
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

function getLiveShopifyQuantityForConflict(
  product: ShopifyProductForConflict,
  hasManagedLocation: boolean,
  preferredVariantGid?: string | null,
) {
  const variant = selectShopifyVariantForSync({
    preferredVariantGid,
    variants: product.variants?.nodes,
  });
  const variantLocationQuantity = getVariantLocationQuantity(variant);

  return hasManagedLocation
    ? variantLocationQuantity
    : (variantLocationQuantity ?? variant?.inventoryQuantity ?? null);
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

function buildPriceConflict(input: {
  lastCompareAtPrice: string | null;
  lastPrice: string | null;
  shopifyCompareAtPrice: string | null;
  shopifyPrice: string | null;
}) {
  const lastSyncBayValue = {
    amount: input.lastPrice,
    compareAtPrice: input.lastCompareAtPrice,
  } satisfies Prisma.JsonObject;
  const shopifyValue = {
    amount: input.shopifyPrice,
    compareAtPrice: input.shopifyCompareAtPrice,
  } satisfies Prisma.JsonObject;

  if (JSON.stringify(lastSyncBayValue) === JSON.stringify(shopifyValue)) {
    return null;
  }

  return {
    ebayValue: lastSyncBayValue,
    field: "price",
    lastSyncBayValue,
    shopifyValue,
  };
}

function buildConflict(
  field: string,
  lastSyncBayValue: Prisma.JsonValue | undefined,
  shopifyValue: Prisma.JsonValue | undefined,
) {
  const normalizedLastValue =
    field === "status"
      ? normalizeProductStatusConflictValue(lastSyncBayValue)
      : normalizeConflictValue(lastSyncBayValue);
  const normalizedShopifyValue =
    field === "status"
      ? normalizeProductStatusConflictValue(shopifyValue)
      : normalizeConflictValue(shopifyValue);

  if (normalizedLastValue === normalizedShopifyValue) return null;

  return {
    ebayValue: normalizedLastValue,
    field,
    lastSyncBayValue: normalizedLastValue,
    shopifyValue: normalizedShopifyValue,
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

async function resolveOrderStockQuantityConflicts(input: {
  defaultLocationGid: string | null;
  mappingId: string;
  mappingStatus: ProductMappingStatus;
  nextQuantity: number;
  shopDomain: string;
  shopId: string;
  shopifyProductGid: string | null;
  shopifyVariantGid: string | null;
}) {
  const conflicts = await prisma.syncConflict.findMany({
    select: {
      field: true,
      id: true,
    },
    where: {
      field: "quantity",
      mappingId: input.mappingId,
      shopId: input.shopId,
      status: SyncConflictStatus.OPEN,
    },
  });
  if (conflicts.length === 0 || !input.shopifyProductGid) return 0;

  const admin = await getShopifyAdminGraphqlClient(input.shopDomain);
  const product = await getShopifyProductForConflict(
    admin,
    input.shopifyProductGid,
    input.defaultLocationGid,
    { preferredVariantGid: input.shopifyVariantGid },
  );
  const liveShopifyQuantity = product
    ? getLiveShopifyQuantityForConflict(
        product,
        Boolean(input.defaultLocationGid),
        input.shopifyVariantGid,
      )
    : null;
  const conflictIds = conflicts.flatMap((conflict) =>
    shouldResolveOrderStockQuantityConflict({
      field: conflict.field,
      liveShopifyQuantity,
      mappingStatus: input.mappingStatus,
      nextQuantity: input.nextQuantity,
    })
      ? [conflict.id]
      : [],
  );

  if (conflictIds.length === 0) return 0;

  const result = await prisma.syncConflict.updateMany({
    data: {
      resolution: SyncConflictResolution.KEEP_SHOPIFY,
      resolvedAt: new Date(),
      status: SyncConflictStatus.RESOLVED,
    },
    where: {
      id: { in: conflictIds },
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

  const latestDescriptionSnapshots = await prisma.$queryRaw<
    { descriptionHash: string | null; mappingId: string | null }[]
  >`
    SELECT DISTINCT ON ("mappingId") "descriptionHash", "mappingId"
    FROM "ProductSnapshot"
    WHERE
      "mappingId" IN (${Prisma.join(mappingIds)})
      AND "shopId" = ${input.shopId}
      AND "source" = 'SYNCBAY'::"ProductSnapshotSource"
      AND "descriptionHash" IS NOT NULL
      AND ${SYNCBAY_DESCRIPTION_BASELINE_PAYLOAD_SQL}
    ORDER BY "mappingId", "capturedAt" DESC
  `;
  const latestDescriptionHashByMappingId = new Map<string, string>();

  for (const snapshot of latestDescriptionSnapshots) {
    if (
      snapshot.mappingId &&
      snapshot.descriptionHash &&
      !latestDescriptionHashByMappingId.has(snapshot.mappingId)
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

async function resolveLiveAlignedPriceConflicts(input: {
  conflicts: {
    field: string;
    id: string;
    lastSyncBayValue: Prisma.JsonValue | null;
    mappingId: string | null;
    mapping: {
      ebayItemId: string;
      id: string;
      shopifyProductGid: string | null;
      shopifyVariantGid: string | null;
      sku: string | null;
      status: ProductMappingStatus;
    } | null;
    shopifyValue: Prisma.JsonValue | null;
  }[];
  defaultLocationGid: string | null;
  job: DueSyncJob;
  shopDomain: string;
}) {
  const candidates = input.conflicts.filter(
    (conflict) =>
      conflict.field === "price" &&
      conflict.mappingId &&
      conflict.mapping?.ebayItemId &&
      conflict.mapping?.shopifyProductGid &&
      shouldResolveLiveAlignedPriceConflictForMappingStatus(
        conflict.mapping?.status ?? null,
      ),
  );
  const itemIds = [
    ...new Set(candidates.flatMap((conflict) => conflict.mapping?.ebayItemId ?? [])),
  ];
  const mappingIds = [
    ...new Set(candidates.flatMap((conflict) => conflict.mappingId ?? [])),
  ];

  if (itemIds.length === 0 || mappingIds.length === 0) {
    return { conflictIds: [], count: 0 };
  }

  const [admin, previewResult, pricingRule, latestSyncBaySnapshots] =
    await Promise.all([
      getShopifyAdminGraphqlClient(input.shopDomain),
      getIncrementalPreviewResult(input.job, itemIds),
      getPricingRuleForShopId(input.job.shopId),
      prisma.productSnapshot.findMany({
        orderBy: { capturedAt: "desc" },
        select: {
          currency: true,
          descriptionHash: true,
          ebayItemId: true,
          imageCount: true,
          mappingId: true,
          payload: true,
          priceAmount: true,
          productStatus: true,
          quantity: true,
          shopId: true,
          shopifyProductGid: true,
          shopifyVariantGid: true,
          sku: true,
          title: true,
        },
        where: {
          mappingId: { in: mappingIds },
          shopId: input.job.shopId,
          source: ProductSnapshotSource.SYNCBAY,
        },
      }),
    ]);
  const previewItemsById = new Map(
    filterPreviewResultByItemIds(previewResult, itemIds).items.map((item) => [
      item.itemId,
      item,
    ]),
  );
  const latestSnapshotByMappingId = new Map<
    string,
    (typeof latestSyncBaySnapshots)[number]
  >();

  for (const snapshot of latestSyncBaySnapshots) {
    if (snapshot.mappingId && !latestSnapshotByMappingId.has(snapshot.mappingId)) {
      latestSnapshotByMappingId.set(snapshot.mappingId, snapshot);
    }
  }

  const conflictIds: string[] = [];
  const syncBaySnapshots: Prisma.ProductSnapshotCreateManyInput[] = [];
  const now = new Date();

  for (const conflict of candidates) {
    const mapping = conflict.mapping;
    const mappingId = conflict.mappingId;
    const item = mapping?.ebayItemId
      ? previewItemsById.get(mapping.ebayItemId)
      : null;
    const latestSnapshot = mappingId
      ? latestSnapshotByMappingId.get(mappingId)
      : null;

    if (
      !mapping ||
      !mappingId ||
      !item ||
      !latestSnapshot ||
      !mapping.shopifyProductGid
    ) {
      continue;
    }

    // Lettura Shopify live per-conflitto, come resolveLiveAlignedDescriptionConflicts:
    // limitata ai soli conflitti prezzo aperti su mapping ACTIVE (volume basso, nessuna
    // write provider). Quando il mapping conserva una variante Shopify specifica,
    // valida quella invece della prima variante del prodotto.
    const product = await getShopifyProductForConflict(
      admin,
      mapping.shopifyProductGid,
      input.defaultLocationGid,
      {
        preferredVariantGid:
          mapping.shopifyVariantGid ?? latestSnapshot.shopifyVariantGid,
      },
    );
    const variant = selectShopifyVariantForSync({
      preferredVariantGid:
        mapping.shopifyVariantGid ?? latestSnapshot.shopifyVariantGid,
      variants: product?.variants?.nodes,
    });
    const repair = getAlignedPriceConflictRepair({
      ebayPriceAmount: item.normalized.priceAmount,
      field: conflict.field,
      latestSyncBayValue: conflict.lastSyncBayValue,
      pricingRule,
      shopifyValue: buildPriceConflictValue({
        compareAtPrice: variant?.compareAtPrice ?? null,
        price: variant?.price ?? null,
      }),
    });

    if (!repair) {
      continue;
    }

    const latestPayload = getJsonObject(latestSnapshot.payload) ?? {};
    const pricingPayload = getJsonObject(latestPayload.pricing) ?? {};

    conflictIds.push(conflict.id);
    syncBaySnapshots.push({
      currency: item.normalized.currency ?? latestSnapshot.currency,
      descriptionHash: latestSnapshot.descriptionHash,
      ebayItemId: latestSnapshot.ebayItemId ?? item.itemId,
      imageCount: latestSnapshot.imageCount,
      mappingId,
      payload: {
        ...latestPayload,
        conflictResolution: {
          conflictId: conflict.id,
          field: conflict.field,
          resolution: SyncConflictResolution.KEEP_SHOPIFY,
          source: "live_aligned_price_conflict_repair",
          syncJobId: input.job.id,
        },
        priceConflictBaselineRepair: {
          conflictId: conflict.id,
          repairedAt: now.toISOString(),
          syncJobId: input.job.id,
        },
        pricing: {
          ...pricingPayload,
          applied: repair.applied,
          compareAtPriceAmount: repair.compareAtPriceAmount,
          discountPercent: repair.discountPercent,
          ebayPriceAmount: repair.ebayPriceAmount,
          priceAmount: repair.priceAmount,
          roundingMode: repair.roundingMode,
        },
      } satisfies Prisma.JsonObject,
      priceAmount: repair.priceAmount,
      productStatus: latestSnapshot.productStatus,
      quantity: latestSnapshot.quantity,
      shopId: input.job.shopId,
      shopifyProductGid:
        latestSnapshot.shopifyProductGid ?? mapping.shopifyProductGid,
      shopifyVariantGid: getPriceConflictRepairSnapshotVariantGid({
        latestSnapshotVariantGid: latestSnapshot.shopifyVariantGid,
        mappingVariantGid: mapping.shopifyVariantGid,
        selectedVariantGid: variant?.id,
      }),
      sku: latestSnapshot.sku ?? mapping.sku,
      source: ProductSnapshotSource.SYNCBAY,
      title: latestSnapshot.title,
    });
  }

  if (conflictIds.length === 0) {
    return { conflictIds: [], count: 0 };
  }

  const changedSyncBaySnapshots =
    await filterChangedSyncBayProductSnapshots(syncBaySnapshots);
  const resolvedMappingIds = [
    ...new Set(
      syncBaySnapshots
        .map((snapshot) => snapshot.mappingId)
        .filter((mappingId): mappingId is string => Boolean(mappingId)),
    ),
  ];

  const result = await prisma.$transaction(async (tx) => {
    const updatedConflicts = await tx.syncConflict.updateMany({
      data: {
        resolution: SyncConflictResolution.KEEP_SHOPIFY,
        resolvedAt: now,
        status: SyncConflictStatus.RESOLVED,
      },
      where: {
        id: { in: conflictIds },
        shopId: input.job.shopId,
        status: SyncConflictStatus.OPEN,
      },
    });
    const finalizedConflictIds = getFinalizedPriceConflictRepairIds({
      conflictIds,
      updatedCount: updatedConflicts.count,
    });

    if (finalizedConflictIds.length !== conflictIds.length) {
      throw new Error(
        "Price conflict repair skipped baseline snapshot because not all conflicts were updated.",
      );
    }

    if (changedSyncBaySnapshots.length > 0) {
      await tx.productSnapshot.createMany({ data: changedSyncBaySnapshots });
    }

    await tx.productMapping.updateMany({
      data: { lastSyncedAt: now },
      where: { id: { in: resolvedMappingIds } },
    });
    await tx.auditLog.create({
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
      data: {
        details: {
          conflictIds: finalizedConflictIds,
          source: "live_aligned_price_conflict_repair",
          syncJobId: input.job.id,
        },
        message: "Conflitti prezzo Shopify allineati risolti dal runner.",
        shopId: input.job.shopId,
        type: AuditEventType.CONNECTION_CHECK,
      },
    });

    return updatedConflicts;
  });

  return { conflictIds, count: result.count };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

function getJsonObject(value: Prisma.JsonValue | null | undefined) {
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

function getNullableStringFromRecord(
  value: Record<string, Prisma.JsonValue> | null,
  key: string,
) {
  const entry = value?.[key];

  return typeof entry === "string" && entry.trim() ? entry.trim() : null;
}

function formatShopifyPrice(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value.toFixed(2);
}

function formatShopifyGraphqlErrors(errors: Array<{ message: string }>) {
  return errors.map((error) => error.message).join("; ");
}

function formatShopifyUserErrors(errors: ShopifyUserError[]) {
  return errors
    .map((error) =>
      error.field?.length
        ? `${error.field.join(".")}: ${error.message}`
        : error.message,
    )
    .join("; ");
}

function getStringFromPayload(payload: Prisma.JsonValue | null, key: string) {
  return getJsonString(getJsonObject(payload)?.[key]);
}

function getBooleanFromPayload(payload: Prisma.JsonValue | null, key: string) {
  const value = getJsonObject(payload)?.[key];

  return typeof value === "boolean" ? value : false;
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

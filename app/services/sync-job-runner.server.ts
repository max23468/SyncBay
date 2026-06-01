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
import { createHash } from "node:crypto";

import prisma from "../db.server";
import { normalizeImportProductStatus } from "../lib/import-product-status";
import { unauthenticated } from "../shopify.server";
import { getUsableEbayAccessToken } from "./ebay-token.server";
import { getEbayTradingCandidatesByItemIds } from "./ebay-trading-preview.server";
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
const INCREMENTAL_SYNC_BATCH_SIZE = 50;
const INCREMENTAL_SYNC_MAX_ATTEMPTS = 3;
const RUNNING_IMPORT_STALE_AFTER_MS = 15 * 60 * 1000;
const STALE_RUNNING_IMPORT_ERROR_CODE = "SYNCBAY_RUNNING_IMPORT_STALE";
const STALE_RUNNING_IMPORT_ERROR_MESSAGE =
  "Job import rimasto RUNNING oltre la finestra di sicurezza del runner.";

export async function runDueSyncJobs(
  input: {
    limit?: number;
    now?: Date;
  } = {},
) {
  const now = input.now ?? new Date();
  const limit = normalizeRunDueLimit(input.limit);

  await enqueueIncrementalSyncJobs(now);
  await recoverStaleRunningImportJobsForDueShops({ limit, now });

  const jobs = await prisma.syncJob.findMany({
    include: { shop: true },
    orderBy: [{ runAfter: "asc" }, { createdAt: "asc" }],
    take: limit,
    where: {
      runAfter: { lte: now },
      status: { in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING] },
      type: { in: getRunnableSyncJobTypes() },
    },
  });
  jobs.sort(compareSyncJobPriority);
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
    succeededCount: completedResults.filter(
      (result) => result.status === "succeeded",
    ).length,
    results: completedResults,
  };
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
  return prisma.$transaction(async (tx) => {
    await lockShopForUpdate(tx, job.shopId);

    const recoveredStaleJobCount = await recoverStaleRunningImportJobs(tx, {
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

async function recoverStaleRunningImportJobsForDueShops(input: {
  limit: number;
  now: Date;
}) {
  const staleCutoff = getRunningImportStaleCutoff(input.now);
  const staleRunningJobs = await prisma.syncJob.findMany({
    orderBy: [{ startedAt: "asc" }, { createdAt: "asc" }],
    select: { shopId: true },
    take: input.limit,
    where: getStaleRunningImportJobWhere(staleCutoff),
  });
  const staleShopIds = [...new Set(staleRunningJobs.map((job) => job.shopId))];

  await Promise.all(
    staleShopIds.map((shopId) =>
      prisma.$transaction(async (tx) => {
        await lockShopForUpdate(tx, shopId);
        await recoverStaleRunningImportJobs(tx, {
          now: input.now,
          shopId,
        });
      }),
    ),
  );
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
        shopId: shop.id,
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

    const mappings = await prisma.productMapping.findMany({
      orderBy: { updatedAt: "asc" },
      select: { ebayItemId: true },
      where: {
        marketplaceId: DEFAULT_MARKETPLACE_ID,
        shopId: shop.id,
        status: ProductMappingStatus.ACTIVE,
      },
    });
    const batches = chunkArray(
      mappings.map((mapping) => mapping.ebayItemId),
      INCREMENTAL_SYNC_BATCH_SIZE,
    );

    if (batches.length === 0) continue;

    const runId = `incremental:${shop.id}:${now.toISOString()}`;

    await prisma.syncJob.createMany({
      data: batches.map((ebayItemIds, index) => ({
        maxAttempts: INCREMENTAL_SYNC_MAX_ATTEMPTS,
        payload: {
          batchCount: batches.length,
          batchIndex: index + 1,
          ebayItemIds,
          marketplaceId: DEFAULT_MARKETPLACE_ID,
          runId,
          source: "trading_api",
        } satisfies Prisma.JsonObject,
        runAfter: now,
        shopId: shop.id,
        status: SyncJobStatus.PENDING,
        type: SyncJobType.SYNC_INCREMENTAL,
      })),
    });
  }
}

async function recoverStaleRunningImportJobs(
  tx: Prisma.TransactionClient,
  input: {
    now: Date;
    shopId: string;
  },
): Promise<number> {
  const staleCutoff = getRunningImportStaleCutoff(input.now);
  const staleJobs = await tx.syncJob.findMany({
    select: {
      attempts: true,
      id: true,
      maxAttempts: true,
      runAfter: true,
      startedAt: true,
    },
    where: getStaleRunningImportJobWhere(staleCutoff, input.shopId),
  });
  let recoveredCount = 0;

  for (const staleJob of staleJobs) {
    const nextAttempts = staleJob.attempts + 1;
    const retryAt =
      nextAttempts < staleJob.maxAttempts ? staleJob.runAfter : null;
    const result = {
      runnerErrorCode: STALE_RUNNING_IMPORT_ERROR_CODE,
      runnerErrorMessage: STALE_RUNNING_IMPORT_ERROR_MESSAGE,
      staleAfterSeconds: RUNNING_IMPORT_STALE_AFTER_MS / 1000,
      staleStartedAt: staleJob.startedAt?.toISOString() ?? null,
      retryScheduledAt: retryAt?.toISOString() ?? null,
      willRetry: Boolean(retryAt),
    } satisfies Prisma.JsonObject;

    await tx.syncJob.update({
      data: {
        attempts: { increment: 1 },
        errorCode: STALE_RUNNING_IMPORT_ERROR_CODE,
        errorMessage: STALE_RUNNING_IMPORT_ERROR_MESSAGE,
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
          ? "Job import RUNNING stantio recuperato; retry pianificato dal runner."
          : "Job import RUNNING stantio segnato come fallito dal runner.",
        shopId: input.shopId,
        type: AuditEventType.SYNC_JOB_FAILED,
      },
    });

    recoveredCount += 1;
  }

  return recoveredCount;
}

function getRunningImportStaleCutoff(now: Date) {
  return new Date(now.getTime() - RUNNING_IMPORT_STALE_AFTER_MS);
}

function getStaleRunningImportJobWhere(
  staleCutoff: Date,
  shopId?: string,
): Prisma.SyncJobWhereInput {
  return {
    OR: [{ startedAt: null }, { startedAt: { lte: staleCutoff } }],
    shopId,
    status: SyncJobStatus.RUNNING,
    type: SyncJobType.IMPORT_CATALOG,
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

  const [{ admin, session }, previewResult] = await Promise.all([
    unauthenticated.admin(job.shop.shopDomain),
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
    shopDomain: session.shop,
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
  const [{ admin, session }, previewResult] = await Promise.all([
    unauthenticated.admin(job.shop.shopDomain),
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
    shopDomain: session.shop,
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
  const { accessToken } = await getUsableEbayAccessToken(connection);
  const updated: Prisma.JsonObject[] = [];
  const skipped: Prisma.JsonObject[] = [];

  for (const lineItem of lineItems) {
    const mapping = await findProductMappingForOrderLine(job.shopId, lineItem);

    if (!mapping) {
      skipped.push({
        quantity: lineItem.quantity,
        reason: "mapping_not_found",
        shopifyProductGid: lineItem.shopifyProductGid ?? null,
        shopifyVariantGid: lineItem.shopifyVariantGid ?? null,
      });
      continue;
    }

    const latestSnapshot = await prisma.productSnapshot.findFirst({
      orderBy: { capturedAt: "desc" },
      where: {
        mappingId: mapping.id,
      },
    });
    const previousQuantity = latestSnapshot?.quantity ?? 0;
    const nextQuantity = Math.max(0, previousQuantity - lineItem.quantity);

    await reviseEbayTradingInventoryQuantity({
      accessToken,
      connection,
      itemId: mapping.ebayItemId,
      quantity: nextQuantity,
      sku: mapping.sku,
    });
    await prisma.productSnapshot.create({
      data: {
        ebayItemId: mapping.ebayItemId,
        mappingId: mapping.id,
        payload: {
          previousQuantity,
          reason: "shopify_order_paid",
          syncJobId: job.id,
          updatedEbayFromShopifyOrder: true,
        } satisfies Prisma.JsonObject,
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
      ebayItemId: mapping.ebayItemId,
      nextQuantity,
      orderedQuantity: lineItem.quantity,
      previousQuantity,
    });
  }

  await markJobSucceeded({
    delegatedJobId: null,
    job,
    result: {
      skipped,
      skippedCount: skipped.length,
      updated,
      updatedCount: updated.length,
    },
    warnings:
      skipped.length > 0 ? ["Alcune righe ordine non hanno mapping."] : [],
  });

  return {
    jobId: job.id,
    status: "succeeded" as const,
    type: job.type,
  };
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

  const { admin } = await unauthenticated.admin(job.shop.shopDomain);
  const [product, snapshot] = await Promise.all([
    getShopifyProductForConflict(admin, mapping.shopifyProductGid),
    prisma.productSnapshot.findFirst({
      orderBy: { capturedAt: "desc" },
      where: {
        mappingId: mapping.id,
        source: ProductSnapshotSource.SYNCBAY,
      },
    }),
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

  const conflicts = getDetectedShopifyConflicts(product, snapshot);

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
        quantity,
        shopifyProductGid: getJsonString(lineItemObject.shopifyProductGid),
        shopifyVariantGid: getJsonString(lineItemObject.shopifyVariantGid),
      },
    ];
  });
}

async function findProductMappingForOrderLine(
  shopId: string,
  lineItem: {
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
) {
  const response = await admin.graphql(
    `#graphql
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
    }`,
    { variables: { id: productGid } },
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
) {
  const variant = product.variants?.nodes?.[0] ?? null;
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
    buildConflict("quantity", snapshot.quantity, variant?.inventoryQuantity),
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
    SyncJobType.IMPORT_CATALOG,
    SyncJobType.SYNC_INCREMENTAL,
    SyncJobType.UPDATE_EBAY_STOCK,
    SyncJobType.DETECT_SHOPIFY_CHANGES,
  ];
}

function compareSyncJobPriority(left: DueSyncJob, right: DueSyncJob) {
  const priorityDiff =
    getSyncJobPriority(left.type) - getSyncJobPriority(right.type);

  if (priorityDiff !== 0) return priorityDiff;

  return left.runAfter.getTime() - right.runAfter.getTime();
}

function getSyncJobPriority(type: SyncJobType) {
  if (type === SyncJobType.UPDATE_EBAY_STOCK) return 0;
  if (type === SyncJobType.SYNC_INCREMENTAL) return 1;
  if (type === SyncJobType.DETECT_SHOPIFY_CHANGES) return 2;
  if (type === SyncJobType.IMPORT_CATALOG) return 3;

  return 99;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function normalizeConflictValue(value: Prisma.JsonValue | undefined) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim();

  return value;
}

function hashNullableText(value: string | null) {
  if (!value) return null;

  return createHash("sha256").update(value).digest("hex");
}

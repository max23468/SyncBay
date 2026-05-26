import {
  AuditEventType,
  EbayConnection,
  EbayConnectionStatus,
  Prisma,
  SyncJobStatus,
  SyncJobType,
} from "@prisma/client";

import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { getUsableEbayAccessToken } from "./ebay-token.server";
import { getEbayTradingCandidatesByItemIds } from "./ebay-trading-preview.server";
import type {
  ImportPreviewItem,
  ImportPreviewResult,
  ImportPreviewSummary,
} from "./import-preview.server";
import { buildImportPreview } from "./import-preview.server";
import { createShopifyDraftProductsIfEnabled } from "./shopify-draft-import.server";

type DueSyncJob = Prisma.SyncJobGetPayload<{ include: { shop: true } }>;

const DEFAULT_RUN_DUE_LIMIT = 5;
const MAX_RUN_DUE_LIMIT = 10;
const DEFAULT_MARKETPLACE_ID = "EBAY_IT";

export async function runDueSyncJobs(
  input: {
    limit?: number;
    now?: Date;
  } = {},
) {
  const now = input.now ?? new Date();
  const limit = normalizeRunDueLimit(input.limit);
  const jobs = await prisma.syncJob.findMany({
    include: { shop: true },
    orderBy: [{ runAfter: "asc" }, { createdAt: "asc" }],
    take: limit,
    where: {
      runAfter: { lte: now },
      status: { in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING] },
      type: SyncJobType.IMPORT_CATALOG,
    },
  });
  const results = [];

  for (const job of jobs) {
    const claimedJob = await claimDueSyncJob(job, now);

    if (!claimedJob) {
      results.push({
        jobId: job.id,
        status: "skipped" as const,
        type: job.type,
      });
      continue;
    }

    results.push(await runDueSyncJob(claimedJob));
  }

  return {
    failedCount: results.filter((result) => result.status === "failed").length,
    processedCount: results.length,
    skippedCount: results.filter((result) => result.status === "skipped")
      .length,
    succeededCount: results.filter((result) => result.status === "succeeded")
      .length,
    results,
  };
}

async function claimDueSyncJob(job: DueSyncJob, now: Date) {
  const claimed = await prisma.syncJob.updateMany({
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
      status: { in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING] },
      type: SyncJobType.IMPORT_CATALOG,
    },
  });

  if (claimed.count !== 1) return null;

  return prisma.syncJob.findUniqueOrThrow({
    include: { shop: true },
    where: { id: job.id },
  });
}

async function runDueSyncJob(job: DueSyncJob) {
  try {
    if (job.type === SyncJobType.IMPORT_CATALOG) {
      return await runImportCatalogJob(job);
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
    defaultLocationGid: job.shop.defaultLocationGid,
    hasDefaultLocation: Boolean(job.shop.defaultLocationGid),
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
  warnings: string[];
}) {
  const result = {
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

function getJsonObject(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  return value as Record<string, Prisma.JsonValue>;
}

function getRetryAfter(attempts: number) {
  const retryDelaySeconds = attempts <= 1 ? 60 : attempts === 2 ? 300 : 900;

  return new Date(Date.now() + retryDelaySeconds * 1000);
}

function normalizeRunDueLimit(limit?: number) {
  if (!Number.isInteger(limit)) return DEFAULT_RUN_DUE_LIMIT;

  return Math.min(Math.max(Number(limit), 1), MAX_RUN_DUE_LIMIT);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;

  return "Errore inatteso durante l'esecuzione del job SyncBay.";
}

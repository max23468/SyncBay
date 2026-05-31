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

const DEFAULT_RUN_DUE_LIMIT = 5;
const MAX_RUN_DUE_LIMIT = 10;
const DEFAULT_MARKETPLACE_ID = "EBAY_IT";
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
    // Serialize claims for the same shop across overlapping Cron invocations.
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "Shop"
      WHERE id = ${job.shopId}
      FOR UPDATE
    `;

    const recoveredStaleJobCount = await recoverStaleRunningImportJobs(tx, {
      now,
      shopId: job.shopId,
    });

    if (recoveredStaleJobCount > 0) return null;

    const runningImportJob = await tx.syncJob.findFirst({
      select: { id: true },
      where: {
        id: { not: job.id },
        shopId: job.shopId,
        status: SyncJobStatus.RUNNING,
        type: SyncJobType.IMPORT_CATALOG,
      },
    });

    if (runningImportJob) return null;

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
        type: SyncJobType.IMPORT_CATALOG,
      },
    });

    if (claimed.count !== 1) return null;

    return tx.syncJob.findUniqueOrThrow({
      include: { shop: true },
      where: { id: job.id },
    });
  });
}

async function recoverStaleRunningImportJobs(
  tx: Prisma.TransactionClient,
  input: {
    now: Date;
    shopId: string;
  },
): Promise<number> {
  const staleCutoff = new Date(
    input.now.getTime() - RUNNING_IMPORT_STALE_AFTER_MS,
  );
  const staleJobs = await tx.syncJob.findMany({
    select: {
      attempts: true,
      id: true,
      maxAttempts: true,
      runAfter: true,
      startedAt: true,
    },
    where: {
      OR: [{ startedAt: null }, { startedAt: { lte: staleCutoff } }],
      shopId: input.shopId,
      status: SyncJobStatus.RUNNING,
      type: SyncJobType.IMPORT_CATALOG,
    },
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

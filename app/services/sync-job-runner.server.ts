import { SyncJobType } from "@prisma/client";
import {
  getNextEbayTradingRateLimitRetryAt,
  isEbayTradingUsageLimitError,
} from "../lib/syncbay-ebay-rate-limit";
import { normalizeRunDueLimit } from "../lib/syncbay-job-scheduling";
import {
  RUNNER_LANES,
  buildRunnerLanePlan,
  shouldClaimRunnerJob,
  type RunnerLane,
} from "../lib/syncbay-runner-fairness";
import { runDailyOperationalMaintenance } from "./product-history.server";

import { runDetectShopifyChangesJob } from "./sync-job-conflicts.server";
import { runImportCatalogJob } from "./sync-job-import.server";
import {
  runIncrementalSyncJob,
  runMarkInactiveListingSoldOutJob,
} from "./sync-job-incremental.server";
import {
  archiveSupersededFailedIncrementalSyncJobs,
  buildRunnerLaneCounts,
  claimDueSyncJob,
  countDueSyncJobsByType,
  enqueueIncrementalSyncJobs,
  findDueSyncJobsByPriority,
  getRunnableSyncJobTypes,
  recoverStaleRunningSyncJobsForDueShops,
} from "./sync-job-scheduling.server";
import {
  DueSyncJob,
  DueSyncJobRunResult,
  getErrorMessage,
  markJobFailedOrRetrying,
} from "./sync-job-shared.server";
import { runUpdateEbayStockJob } from "./sync-job-stock.server";

type DueSyncJobRunQueueItem = {
  index: number;
  job: DueSyncJob;
};

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
  const cleanedInternalImportJobCount = 0;

  const dueByType = await countDueSyncJobsByType(now);
  const schedulableDueByType = { ...dueByType };
  const runnableTypes = new Set<SyncJobType>(getRunnableSyncJobTypes());
  for (const lane of RUNNER_LANES) {
    if (!runnableTypes.has(lane as SyncJobType)) {
      schedulableDueByType[lane] = 0;
    }
  }
  const lanePlan = buildRunnerLanePlan({
    dueByType: schedulableDueByType,
    limit,
  });
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
      runDueSyncJobGroup(shopJobs, results, now, input.deadlineAt, deadlineState),
    ),
  );

  const completedResults = results.filter((result): result is DueSyncJobRunResult =>
    Boolean(result),
  );
  const [archivedStaleFailedJobCount, retentionCleanup] = await Promise.all([
    archiveSupersededFailedIncrementalSyncJobs({ now }),
    runDailyOperationalMaintenance({ now }),
  ]);
  const selectedByType = buildRunnerLaneCounts(
    completedResults.map((result) => result.type as RunnerLane),
  );
  const dueCount = Object.values(dueByType).reduce((total, count) => total + count, 0);

  return {
    archivedStaleFailedJobCount,
    failedCount: completedResults.filter((result) => result.status === "failed").length,
    processedCount: completedResults.length,
    skippedCount: completedResults.filter((result) => result.status === "skipped").length,
    cleanedInternalImportJobCount,
    continuationNeeded: deadlineState.continuationNeeded || dueCount > completedResults.length,
    dueByType,
    elapsedMs: Date.now() - startedAt,
    retentionCleanup,
    selectedByType,
    succeededCount: completedResults.filter((result) => result.status === "succeeded").length,
    results: completedResults,
  };
}

export async function runDueSyncJobGroup(
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

  await runDueSyncJobGroup(remainingJobs, results, now, deadlineAt, deadlineState);
}

export async function runDueSyncJob(job: DueSyncJob) {
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
          cooldownSecondsValue: process.env.SYNCBAY_EBAY_TRADING_RATE_LIMIT_COOLDOWN_SECONDS,
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

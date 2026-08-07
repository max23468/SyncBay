import { SyncJobStatus, SyncJobType } from "@prisma/client";
import prisma from "../db.server";
import {
  buildSeededShopifyChangeBatch,
  type ShopifyChangeBatchJob,
} from "../lib/syncbay-shopify-change-batch";
import {
  detectShopifyChangesBatch,
  type ShopifyChangeBatchExecution,
} from "./shopify-conflict-detection.server";

import {
  DueSyncJob,
  DueSyncJobRunResult,
  dueSyncJobSelect,
  getErrorMessage,
  getStringFromPayload,
  markJobFailedOrRetrying,
  markJobSucceeded,
} from "./sync-job-shared.server";

export async function runDetectShopifyChangesJob(job: DueSyncJob) {
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
  const batch = buildSeededShopifyChangeBatch(
    toShopifyChangeBatchJob(job),
    queued.map(toShopifyChangeBatchJob),
  );
  const selectedIds = new Set([...batch.jobs.map(({ id }) => id), ...batch.duplicateJobIds]);
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
      where: {
        id: { in: batch.duplicateJobIds },
        status: SyncJobStatus.RUNNING,
      },
    });
  }

  const distinctJobs = batch.jobs.filter(({ id }) => absorbedById.has(id));
  let execution: ShopifyChangeBatchExecution;
  try {
    execution = await detectShopifyChangesBatch({
      jobs: distinctJobs,
      shopDomain: job.shop.shopDomain,
      defaultLocationGid: job.shop.defaultLocationGid,
    });

    for (const result of execution.results) {
      const absorbedJob = absorbedById.get(result.jobId);
      if (!absorbedJob) continue;
      if (result.outcome === "failed") {
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- transizioni di stato job con guardia RUNNING: l'ordine seriale è necessario per la correttezza.
        await markJobFailedOrRetrying({
          errorCode: result.errorCode ?? "SHOPIFY_CONFLICT_BATCH_FAILED",
          errorMessage: "Rilevamento conflitti Shopify non completato.",
          job: absorbedJob,
        });
        continue;
      }
      await markJobSucceeded({
        job: absorbedJob,
        result: {
          fields: result.fields,
          outcome: result.outcome,
          providerReadCount: execution.providerReadCount,
        },
        warnings:
          result.outcome === "mapping_not_found"
            ? ["Webhook Shopify senza mapping SyncBay collegato."]
            : [],
      });
    }
  } catch (error) {
    // Se il batch lancia dopo aver messo i sibling in RUNNING (errore
    // Shopify/API/JSON), il catch esterno fallisce solo il seed: i sibling
    // assorbiti resterebbero RUNNING fino alla stale recovery (15 min) e
    // `claimDueSyncJob` blocca l'intero shop finché esiste un job runnable in
    // RUNNING. Rilasciali subito con retry/fail (guardia `status: RUNNING`,
    // quindi non tocca quelli già processati), poi rilancia per il seed.
    const errorMessage = getErrorMessage(error);
    for (const absorbedJob of absorbedJobs) {
      if (absorbedJob.id === job.id) continue;
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- recovery dei sibling assorbiti con guardia RUNNING: l'ordine seriale è necessario per la correttezza.
      await markJobFailedOrRetrying({
        errorCode: "SHOPIFY_CONFLICT_BATCH_FAILED",
        errorMessage,
        job: absorbedJob,
      });
    }
    throw error;
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

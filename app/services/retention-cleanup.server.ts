/**
 * Esecuzione del cleanup retention (ADR 0017 + ADR 0018).
 *
 * Cancella i record scaduti per ogni area governata dalle policy retention,
 * usando i cutoff deterministici calcolati da `buildRetentionCleanupPlan`. Gira
 * nel tick del cron job (`runDueSyncJobs`): essendo idempotente (cancella solo
 * ciò che è anteriore al cutoff), può girare a ogni tick senza effetti
 * collaterali — dopo il primo allineamento ogni esecuzione tocca solo i pochi
 * record appena scaduti.
 *
 * Abilitato di default; disattivabile con `SYNCBAY_RETENTION_CLEANUP_ENABLED=false`
 * per tornare a un comportamento di sola pianificazione (dry-run) senza
 * cancellazioni reali. I conteggi finiscono nel log e nella risposta del cron,
 * così la cancellazione resta osservabile.
 */

import {
  AuditEventType,
  EbayAccountDeletionRequestStatus,
  SyncJobStatus,
} from "@prisma/client";

import prisma from "../db.server";
import { buildRetentionCleanupPlan } from "../lib/syncbay-retention-cleanup";
import type { RetentionCleanupTarget } from "../lib/syncbay-retention-cleanup";
import { SYNCBAY_RETENTION_POLICIES } from "../lib/syncbay-retention-policy";

const TERMINAL_SYNC_JOB_STATUSES = [
  SyncJobStatus.SUCCEEDED,
  SyncJobStatus.FAILED,
  SyncJobStatus.CANCELLED,
];

export interface RetentionCleanupAreaResult {
  area: RetentionCleanupTarget["area"];
  cutoff: string;
  deletedCount: number;
}

export interface RetentionCleanupResult {
  areas: RetentionCleanupAreaResult[];
  enabled: boolean;
  totalDeleted: number;
}

function isRetentionCleanupEnabled() {
  return process.env.SYNCBAY_RETENTION_CLEANUP_ENABLED?.trim() !== "false";
}

export async function runRetentionCleanup(
  input: { now?: Date } = {},
): Promise<RetentionCleanupResult> {
  const now = input.now ?? new Date();
  const enabled = isRetentionCleanupEnabled();
  const plan = buildRetentionCleanupPlan({
    now,
    policies: SYNCBAY_RETENTION_POLICIES,
  });

  const areas: RetentionCleanupAreaResult[] = [];
  let totalDeleted = 0;

  for (const target of plan) {
    const deletedCount = enabled ? await deleteExpiredRecords(target) : 0;
    totalDeleted += deletedCount;
    areas.push({
      area: target.area,
      cutoff: target.cutoff.toISOString(),
      deletedCount,
    });
  }

  if (enabled && totalDeleted > 0) {
    console.info(
      `[syncbay] retention cleanup ha rimosso ${totalDeleted} record scaduti`,
      areas.filter((area) => area.deletedCount > 0),
    );
  }

  return { areas, enabled, totalDeleted };
}

async function deleteExpiredRecords(target: RetentionCleanupTarget) {
  switch (target.area) {
    case "audit_logs": {
      const { count } = await prisma.auditLog.deleteMany({
        where: { createdAt: { lte: target.cutoff } },
      });
      return count;
    }
    case "shopify_webhook_audit_logs": {
      const { count } = await prisma.auditLog.deleteMany({
        where: {
          createdAt: { lte: target.cutoff },
          type: AuditEventType.SHOPIFY_WEBHOOK_RECEIVED,
        },
      });
      return count;
    }
    case "sync_jobs": {
      const { count } = await prisma.syncJob.deleteMany({
        where: {
          createdAt: { lte: target.cutoff },
          status: { in: TERMINAL_SYNC_JOB_STATUSES },
        },
      });
      return count;
    }
    case "succeeded_sync_jobs": {
      const { count } = await prisma.syncJob.deleteMany({
        where: {
          createdAt: { lte: target.cutoff },
          status: SyncJobStatus.SUCCEEDED,
        },
      });
      return count;
    }
    case "product_snapshots": {
      const { count } = await prisma.productSnapshot.deleteMany({
        where: { capturedAt: { lte: target.cutoff } },
      });
      return count;
    }
    case "oauth_states": {
      const { count } = await prisma.ebayOAuthState.deleteMany({
        where: { createdAt: { lte: target.cutoff } },
      });
      return count;
    }
    case "account_deletion_no_match_requests": {
      const { count } = await prisma.ebayAccountDeletionRequest.deleteMany({
        where: {
          createdAt: { lte: target.cutoff },
          matchedShopCount: 0,
          status: EbayAccountDeletionRequestStatus.NO_MATCH,
        },
      });
      return count;
    }
    case "account_deletion_requests": {
      const { count } = await prisma.ebayAccountDeletionRequest.deleteMany({
        where: {
          createdAt: { lte: target.cutoff },
          status: { not: EbayAccountDeletionRequestStatus.NO_MATCH },
        },
      });
      return count;
    }
    default:
      return 0;
  }
}

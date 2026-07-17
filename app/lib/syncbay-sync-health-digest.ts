/**
 * "Battito sync": riepilogo operativo a colpo d'occhio per la Panoramica.
 *
 * Compone presentazioni già calcolate altrove — lo stato di freschezza del
 * catalogo (`getCatalogSyncHealth`) e i job in quarantena
 * (`summarizeSyncJobQuarantine`) — con i volumi reali delle ultime ore
 * (sincronizzati, falliti) e i conflitti aperti, producendo un titolo sintetico
 * leggibile dal negoziante: `ok`, `attention` o `degraded`. Nessun dato
 * sintetico: con coda vuota i conteggi sono zero e il titolo dipende solo dalla
 * freschezza.
 *
 * `lagSeconds` espone di quanto il sync reale è in ritardo rispetto al target
 * configurato (0 quando è in pari o in anticipo), così la deriva dal target di
 * sync configurato diventa visibile invece che silenziosa.
 *
 * Il modulo resta puro e autonomo (solo `import type` dai fratelli): il loader
 * della Panoramica compone i tre lib e passa qui i risultati.
 */

import type { CatalogSyncHealthStatus } from "./syncbay-sync-health";

export type SyncHealthDigestHeadline = "attention" | "degraded" | "ok";

export interface SyncHealthDigestJob {
  createdAt: Date;
  status: string;
}

export interface SyncHealthDigestInput {
  conflictsOpen: number;
  healthStatus: CatalogSyncHealthStatus;
  jobs: SyncHealthDigestJob[];
  now: Date;
  quarantinedCount: number;
  secondsUntilDue: number | null;
  windowHours?: number;
}

export interface SyncHealthDigest {
  conflictsOpen: number;
  failedCount: number;
  headline: SyncHealthDigestHeadline;
  healthStatus: CatalogSyncHealthStatus;
  lagBreached: boolean;
  lagSeconds: number;
  quarantinedCount: number;
  syncedCount: number;
  windowHours: number;
}

const DEFAULT_WINDOW_HOURS = 24;

export function buildSyncHealthDigest(
  input: SyncHealthDigestInput,
): SyncHealthDigest {
  const windowHours = normalizeWindowHours(input.windowHours);
  const windowStart = new Date(
    input.now.getTime() - windowHours * 60 * 60 * 1000,
  );
  const conflictsOpen = Math.max(0, Math.trunc(input.conflictsOpen) || 0);
  const quarantinedCount = Math.max(0, Math.trunc(input.quarantinedCount) || 0);

  const windowJobs = input.jobs.filter((job) => job.createdAt >= windowStart);
  const syncedCount = windowJobs.filter(
    (job) => job.status?.toUpperCase() === "SUCCEEDED",
  ).length;
  const failedCount = windowJobs.filter(
    (job) => job.status?.toUpperCase() === "FAILED",
  ).length;

  const lagBreached = input.healthStatus === "overdue";
  const lagSeconds =
    lagBreached && input.secondsUntilDue !== null && input.secondsUntilDue < 0
      ? Math.abs(input.secondsUntilDue)
      : 0;

  return {
    conflictsOpen,
    failedCount,
    headline: resolveHeadline({
      conflictsOpen,
      failedCount,
      lagBreached,
      quarantinedCount,
    }),
    healthStatus: input.healthStatus,
    lagBreached,
    lagSeconds,
    quarantinedCount,
    syncedCount,
    windowHours,
  };
}

function resolveHeadline(input: {
  conflictsOpen: number;
  failedCount: number;
  lagBreached: boolean;
  quarantinedCount: number;
}): SyncHealthDigestHeadline {
  if (input.quarantinedCount > 0 || input.lagBreached) {
    return "degraded";
  }

  if (input.conflictsOpen > 0 || input.failedCount > 0) {
    return "attention";
  }

  return "ok";
}

function normalizeWindowHours(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_WINDOW_HOURS;
  }

  return Math.trunc(value);
}

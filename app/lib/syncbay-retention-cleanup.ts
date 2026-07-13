/**
 * Pianificazione deterministica del cleanup retention (ADR 0017).
 *
 * Calcola, per ogni area governata dalle policy retention, la data di taglio
 * oltre la quale i record sono scaduti e vanno rimossi. È il nucleo riusabile e
 * testabile del cleanup automatico: non esegue cancellazioni, ma descrive con
 * precisione cosa eliminare e da quando. L'esecuzione distruttiva vera (DELETE
 * batch + schedulazione Supabase Cron) resta un passo separato da abilitare con
 * conferma del maintainer, perché tocca dati e introduce un job pianificato.
 *
 * Le policy arrivano come parametro (il chiamante passa
 * `SYNCBAY_RETENTION_POLICIES`): il modulo resta puro e autonomo, con solo
 * `import type` dal fratello.
 */

import type { SyncBayRetentionPolicy } from "./syncbay-retention-policy";

export interface RetentionCleanupTarget {
  area: SyncBayRetentionPolicy["area"];
  cutoff: Date;
  label: string;
  retentionDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Data di taglio: i record con timestamp anteriore o uguale sono scaduti.
 */
export function getRetentionCutoff(retentionDays: number, now: Date) {
  const days = normalizeRetentionDays(retentionDays);

  return new Date(now.getTime() - days * DAY_MS);
}

/**
 * Piano di cleanup per le policy passate (eventualmente filtrate per area), con
 * cutoff calcolato per ognuna.
 */
export function buildRetentionCleanupPlan(input: {
  areas?: SyncBayRetentionPolicy["area"][];
  now: Date;
  policies: SyncBayRetentionPolicy[];
}): RetentionCleanupTarget[] {
  const allowed = input.areas ? new Set(input.areas) : null;

  return input.policies.flatMap((policy) =>
    allowed === null || allowed.has(policy.area)
      ? [
          {
            area: policy.area,
            cutoff: getRetentionCutoff(policy.retentionDays, input.now),
            label: policy.label,
            retentionDays: policy.retentionDays,
          },
        ]
      : [],
  );
}

/**
 * Vero quando un timestamp è scaduto rispetto al cutoff (anteriore o uguale).
 */
export function isExpiredAtCutoff(
  timestamp: Date | string | null | undefined,
  cutoff: Date,
) {
  const time = toTime(timestamp);
  if (time === null) return false;

  return time <= cutoff.getTime();
}

/**
 * Filtra i record scaduti rispetto a un cutoff, utile per report dry-run prima
 * di abilitare qualsiasi cancellazione reale.
 */
export function selectExpiredRecords<T>(
  records: T[],
  cutoff: Date,
  getTimestamp: (record: T) => Date | string | null | undefined,
) {
  return records.filter((record) =>
    isExpiredAtCutoff(getTimestamp(record), cutoff),
  );
}

export function getExpiredSucceededSyncJobsWhere(cutoff: Date) {
  return {
    OR: [
      { idempotencyKey: null },
      {
        idempotencyKey: {
          not: { startsWith: "facet-backfill-marker:" },
        },
      },
    ],
    createdAt: { lte: cutoff },
    status: "SUCCEEDED" as const,
  };
}

function normalizeRetentionDays(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 1;

  return Math.trunc(value);
}

function toTime(value: Date | string | null | undefined) {
  if (!value) return null;

  const time =
    value instanceof Date ? value.getTime() : new Date(value).getTime();

  return Number.isFinite(time) ? time : null;
}

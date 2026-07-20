/**
 * Classificazione "dead-letter" dei job SyncBay senza nuovi stati a schema.
 *
 * Un job fallito che ha ancora tentativi disponibili è un fallimento ordinario
 * che la coda ritenta da sola: non deve generare rumore né richiedere azione.
 * Un job `FAILED` che ha esaurito `maxAttempts` è invece in quarantena: la coda
 * non lo ritenterà più da sola e serve una decisione del negoziante (retry
 * guidato o chiusura). Questa distinzione rende l'errore azionabile in
 * dashboard invece di ripetersi in modo silenzioso nella timeline Attività.
 *
 * La quarantena è derivata dai campi esistenti (`status`, `attempts`,
 * `maxAttempts`) per non introdurre un valore enum o una migration: lo stato
 * terminale resta `FAILED`, ma viene letto come quarantena quando i tentativi
 * sono esauriti.
 */

export type SyncJobQuarantineState = "actionable" | "retrying" | "settled";

export interface SyncJobQuarantineInput {
  attempts: number;
  maxAttempts: number;
  status: string;
}

const RETRYABLE_PENDING_STATUSES = new Set(["PENDING", "RETRYING", "RUNNING"]);
const SETTLED_STATUSES = new Set(["SUCCEEDED", "CANCELLED"]);

/**
 * Vero quando il job ha consumato tutti i tentativi previsti dalla coda.
 */
export function hasExhaustedSyncJobAttempts(
  input: Pick<SyncJobQuarantineInput, "attempts" | "maxAttempts">,
) {
  const maxAttempts = normalizeMaxAttempts(input.maxAttempts);
  const attempts = Number.isFinite(input.attempts) ? Math.max(0, Math.trunc(input.attempts)) : 0;

  return attempts >= maxAttempts;
}

/**
 * Vero solo per i job in quarantena: falliti e senza ulteriori retry automatici.
 */
export function isSyncJobQuarantined(input: SyncJobQuarantineInput) {
  return classifySyncJobQuarantine(input) === "actionable";
}

/**
 * Distingue i job conclusi (`settled`), quelli che la coda ritenterà ancora
 * (`retrying`) e quelli che richiedono un intervento (`actionable`).
 */
export function classifySyncJobQuarantine(input: SyncJobQuarantineInput): SyncJobQuarantineState {
  const status = input.status?.trim().toUpperCase() ?? "";

  if (SETTLED_STATUSES.has(status)) return "settled";
  if (RETRYABLE_PENDING_STATUSES.has(status)) return "retrying";

  if (status === "FAILED") {
    return hasExhaustedSyncJobAttempts(input) ? "actionable" : "retrying";
  }

  return "retrying";
}

export interface SyncJobQuarantineSummary {
  actionableCount: number;
  retryingCount: number;
  settledCount: number;
  total: number;
}

/**
 * Riepiloga una coda di job per separare il rumore ordinario dai job che
 * richiedono davvero attenzione.
 */
export function summarizeSyncJobQuarantine(
  jobs: SyncJobQuarantineInput[],
): SyncJobQuarantineSummary {
  return jobs.reduce<SyncJobQuarantineSummary>(
    (summary, job) => {
      const state = classifySyncJobQuarantine(job);
      summary.total += 1;

      if (state === "actionable") summary.actionableCount += 1;
      else if (state === "retrying") summary.retryingCount += 1;
      else summary.settledCount += 1;

      return summary;
    },
    { actionableCount: 0, retryingCount: 0, settledCount: 0, total: 0 },
  );
}

function normalizeMaxAttempts(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 1;

  return Math.max(1, Math.trunc(value));
}

export function getRecoverableRunningSyncJobTypes<T extends string>(
  runnableTypes: T[],
) {
  return [...new Set(runnableTypes)];
}

export function isStaleRunningSyncJob(input: {
  now: Date;
  runnableTypes: string[];
  staleAfterMs: number;
  startedAt: Date | null;
  status: string;
  type: string;
}) {
  if (input.status !== "RUNNING") return false;
  if (!input.runnableTypes.includes(input.type)) return false;
  if (!Number.isFinite(input.staleAfterMs) || input.staleAfterMs <= 0) {
    return false;
  }
  if (!input.startedAt) return true;

  return input.startedAt.getTime() <= input.now.getTime() - input.staleAfterMs;
}

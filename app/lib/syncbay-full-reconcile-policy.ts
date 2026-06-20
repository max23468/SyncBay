export type FullReconcilePolicyStatus =
  | "due_soon"
  | "fresh"
  | "missing"
  | "overdue";

export function getFullReconcilePolicyState(input: {
  intervalHours: number;
  latestFinishedAt: Date | null;
  now: Date;
}): {
  intervalHours: number;
  latestFinishedAt: string | null;
  nextDueAt: string | null;
  status: FullReconcilePolicyStatus;
} {
  const intervalHours = Math.max(1, input.intervalHours);

  if (!input.latestFinishedAt) {
    return {
      intervalHours,
      latestFinishedAt: null,
      nextDueAt: null,
      status: "missing",
    };
  }

  const intervalMs = intervalHours * 60 * 60 * 1000;
  const dueAt = new Date(input.latestFinishedAt.getTime() + intervalMs);
  const remainingMs = dueAt.getTime() - input.now.getTime();

  if (remainingMs <= 0) {
    return {
      intervalHours,
      latestFinishedAt: input.latestFinishedAt.toISOString(),
      nextDueAt: dueAt.toISOString(),
      status: "overdue",
    };
  }

  return {
    intervalHours,
    latestFinishedAt: input.latestFinishedAt.toISOString(),
    nextDueAt: dueAt.toISOString(),
    status: remainingMs <= intervalMs * 0.25 ? "due_soon" : "fresh",
  };
}

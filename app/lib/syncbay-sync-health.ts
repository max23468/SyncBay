export type CatalogSyncHealthStatus =
  | "disabled"
  | "due"
  | "fresh"
  | "overdue"
  | "running";

export function getCatalogSyncHealth(input: {
  activeIncrementalJobCount: number;
  latestIncrementalFinishedAt: Date | null;
  now: Date;
  syncEnabled: boolean;
  syncTargetSeconds: number;
}): {
  nextDueAt: Date | null;
  secondsUntilDue: number | null;
  status: CatalogSyncHealthStatus;
} {
  if (!input.syncEnabled) {
    return {
      nextDueAt: null,
      secondsUntilDue: null,
      status: "disabled",
    };
  }

  const nextDueAt = input.latestIncrementalFinishedAt
    ? new Date(
        input.latestIncrementalFinishedAt.getTime() +
          input.syncTargetSeconds * 1000,
      )
    : input.now;
  const secondsUntilDue = Math.round(
    (nextDueAt.getTime() - input.now.getTime()) / 1000,
  );

  if (input.activeIncrementalJobCount > 0) {
    return {
      nextDueAt,
      secondsUntilDue,
      status: "running",
    };
  }

  return {
    nextDueAt,
    secondsUntilDue,
    status:
      secondsUntilDue > 0 ? "fresh" : secondsUntilDue === 0 ? "due" : "overdue",
  };
}

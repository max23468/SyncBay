export type CatalogSyncHealthStatus =
  | "disabled"
  | "due"
  | "fresh"
  | "overdue"
  | "running";

const DEFAULT_OVERDUE_GRACE_SECONDS = 300;

export function getCatalogSyncHealth(input: {
  activeIncrementalJobCount: number;
  latestIncrementalFinishedAt: Date | null;
  now: Date;
  overdueGraceSeconds?: number;
  syncEnabled: boolean;
  syncTargetSeconds: number;
}): {
  nextDueAt: Date | null;
  overdueAt: Date | null;
  secondsUntilDue: number | null;
  status: CatalogSyncHealthStatus;
} {
  if (!input.syncEnabled) {
    return {
      nextDueAt: null,
      overdueAt: null,
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
  const overdueGraceSeconds = normalizeOverdueGraceSeconds(
    input.overdueGraceSeconds,
  );
  const overdueAt = new Date(
    nextDueAt.getTime() + (overdueGraceSeconds + 1) * 1000,
  );

  if (input.activeIncrementalJobCount > 0) {
    return {
      nextDueAt,
      overdueAt,
      secondsUntilDue,
      status: "running",
    };
  }

  return {
    nextDueAt,
    overdueAt,
    secondsUntilDue,
    status:
      secondsUntilDue > 0
        ? "fresh"
        : secondsUntilDue < -overdueGraceSeconds
          ? "overdue"
          : "due",
  };
}

function normalizeOverdueGraceSeconds(value: number | undefined) {
  if (value === undefined) return DEFAULT_OVERDUE_GRACE_SECONDS;
  if (!Number.isFinite(value) || value < 0) return DEFAULT_OVERDUE_GRACE_SECONDS;

  return Math.trunc(value);
}

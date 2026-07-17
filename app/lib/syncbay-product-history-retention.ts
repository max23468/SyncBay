const DAY_MS = 24 * 60 * 60 * 1_000;

export function buildProductHistoryRetentionPlan(now: Date) {
  return {
    eventCutoff: new Date(now.getTime() - 30 * DAY_MS),
    checkpointCutoff: new Date(now.getTime() - 180 * DAY_MS),
  };
}

export function getOperationalMaintenanceKey(now: Date) {
  return `operational-maintenance:${now.toISOString().slice(0, 10)}`;
}

export function shouldCreateWeeklyCheckpoint(input: {
  currentDigest: string | null;
  nextDigest: string;
}) {
  return input.currentDigest !== input.nextDigest;
}

interface ProductCheckpointCoverage {
  checkpointWeek: Date;
  isComplete: boolean;
}

export function getCoveringProductCheckpoint(input: {
  checkpoints: ProductCheckpointCoverage[];
  snapshotWeek: Date;
}) {
  const latest = input.checkpoints
    .filter((checkpoint) => checkpoint.checkpointWeek <= input.snapshotWeek)
    .sort(
      (left, right) =>
        right.checkpointWeek.getTime() - left.checkpointWeek.getTime(),
    )[0];

  return latest?.isComplete ? latest : null;
}

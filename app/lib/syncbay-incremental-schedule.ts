export function getNextIncrementalEnqueueAt(input: {
  latestJob: {
    createdAt: Date;
    finishedAt: Date | null;
    runAfter: Date;
  } | null;
  now: Date;
  syncTargetSeconds: number;
}) {
  if (!input.latestJob) return input.now;

  const base = input.latestJob.finishedAt ?? input.latestJob.createdAt;
  const targetNextRunAt = new Date(base.getTime() + input.syncTargetSeconds * 1000);

  return input.latestJob.runAfter > targetNextRunAt ? input.latestJob.runAfter : targetNextRunAt;
}

export function shouldEnqueueIncrementalSyncNow(input: { nextRunAfter: Date; now: Date }) {
  return input.nextRunAfter.getTime() <= input.now.getTime();
}

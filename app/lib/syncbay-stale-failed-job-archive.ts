export const STALE_FAILED_INCREMENTAL_SYNC_ARCHIVE_AFTER_MS =
  24 * 60 * 60 * 1000;

export const STALE_FAILED_INCREMENTAL_SYNC_ERROR_CODES = [
  "SYNCBAY_INCREMENTAL_BLOCKED",
  "SYNCBAY_INCREMENTAL_ENQUEUE_FAILED",
] as const;

export function isSupersededFailedIncrementalSyncJob(input: {
  archiveAfterMs?: number;
  errorCode?: string | null;
  latestSuccessfulIncrementalSyncAt?: Date | string | null;
  now: Date;
  status: string;
  type: string;
  updatedAt: Date | string;
}) {
  if (input.type !== "SYNC_INCREMENTAL") return false;
  if (input.status !== "FAILED") return false;
  if (!isStaleFailedIncrementalSyncErrorCode(input.errorCode)) return false;

  const updatedAt = getTime(input.updatedAt);
  const latestSuccessAt = getNullableTime(
    input.latestSuccessfulIncrementalSyncAt,
  );

  if (latestSuccessAt === null || updatedAt === null) return false;
  if (latestSuccessAt <= updatedAt) return false;

  const archiveAfterMs =
    input.archiveAfterMs ?? STALE_FAILED_INCREMENTAL_SYNC_ARCHIVE_AFTER_MS;

  if (!Number.isFinite(archiveAfterMs) || archiveAfterMs <= 0) {
    return false;
  }

  return updatedAt <= input.now.getTime() - archiveAfterMs;
}

function isStaleFailedIncrementalSyncErrorCode(errorCode?: string | null) {
  return STALE_FAILED_INCREMENTAL_SYNC_ERROR_CODES.includes(
    errorCode as (typeof STALE_FAILED_INCREMENTAL_SYNC_ERROR_CODES)[number],
  );
}

function getNullableTime(value?: Date | string | null) {
  if (!value) return null;

  return getTime(value);
}

function getTime(value: Date | string) {
  const time =
    value instanceof Date ? value.getTime() : new Date(value).getTime();

  return Number.isFinite(time) ? time : null;
}

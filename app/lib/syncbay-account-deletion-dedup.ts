export interface AccountDeletionDedupInput {
  eventDate: Date | null;
  publishDate: Date | null;
}

export interface AccountDeletionDedupAnchor {
  field: "eventDate" | "publishDate";
  value: Date;
}

export type AccountDeletionPersistenceMode = "noop" | "persist";

/**
 * eBay retries should reuse `notificationId`, but the pilot observed bursts that
 * looked like repeated pings. When the ID changes, dedupe only on the strongest
 * stable timestamp available for the same hashed user, keeping compliance
 * records for genuinely different events.
 */
export function getAccountDeletionDedupAnchor(
  input: AccountDeletionDedupInput,
): AccountDeletionDedupAnchor | null {
  if (isValidDate(input.eventDate)) {
    return { field: "eventDate", value: input.eventDate };
  }

  if (isValidDate(input.publishDate)) {
    return { field: "publishDate", value: input.publishDate };
  }

  return null;
}

export function getAccountDeletionPersistenceMode(input: {
  matchedShopCount: number;
}): AccountDeletionPersistenceMode {
  return input.matchedShopCount > 0 ? "persist" : "noop";
}

function isValidDate(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

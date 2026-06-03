export const DEFAULT_EBAY_FULL_RECONCILE_INTERVAL_SECONDS = 24 * 60 * 60;
export const EBAY_SELLER_EVENTS_MAX_LOOKBACK_SECONDS = 48 * 60 * 60;
export const EBAY_SELLER_EVENTS_OVERLAP_SECONDS = 2 * 60;
export const EBAY_SELLER_EVENTS_TO_BUFFER_SECONDS = 2 * 60;

export function getEbayFullReconcileIntervalSeconds(value?: string | null) {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_EBAY_FULL_RECONCILE_INTERVAL_SECONDS;
  }

  return Math.min(parsed, 7 * 24 * 60 * 60);
}

export function isFullCatalogReconcileDue(input: {
  intervalSecondsValue?: string | null;
  latestFullReconcileAt: Date | null;
  now: Date;
}) {
  if (!input.latestFullReconcileAt) return true;

  const intervalSeconds = getEbayFullReconcileIntervalSeconds(
    input.intervalSecondsValue,
  );

  return (
    input.latestFullReconcileAt.getTime() + intervalSeconds * 1000 <=
    input.now.getTime()
  );
}

export function getSellerEventsDeltaWindow(input: {
  latestSuccessfulSyncAt: Date | null;
  now: Date;
}) {
  if (!input.latestSuccessfulSyncAt) return null;

  const modTimeTo = new Date(
    input.now.getTime() - EBAY_SELLER_EVENTS_TO_BUFFER_SECONDS * 1000,
  );
  const modTimeFrom = new Date(
    input.latestSuccessfulSyncAt.getTime() -
      EBAY_SELLER_EVENTS_OVERLAP_SECONDS * 1000,
  );

  if (modTimeTo <= modTimeFrom) return null;

  const lookbackSeconds =
    (modTimeTo.getTime() - modTimeFrom.getTime()) / 1000;

  if (lookbackSeconds > EBAY_SELLER_EVENTS_MAX_LOOKBACK_SECONDS) return null;

  return {
    modTimeFrom,
    modTimeTo,
  };
}

export function getSellerEventsWatermarkAt(input: {
  latestFullReconcileCompletedAt?: Date | null;
  latestFullReconcileWatermarkAt: Date | null;
  latestSellerEventsCompletedAt: Date | null;
  latestSellerEventsModTimeToValue?: string | null;
}) {
  const sellerEventsWatermark =
    parseDate(input.latestSellerEventsModTimeToValue) ??
    input.latestSellerEventsCompletedAt;

  return maxDate(sellerEventsWatermark, input.latestFullReconcileWatermarkAt);
}

export function shouldAdvanceSellerEventsArchiveWatermark(input: {
  archiveOnly: boolean;
  statuses: string[];
}) {
  return (
    input.archiveOnly &&
    input.statuses.length > 0 &&
    input.statuses.every((status) => status === "SUCCEEDED")
  );
}

function maxDate(first: Date | null, second: Date | null) {
  if (!first) return second;
  if (!second) return first;

  return first.getTime() >= second.getTime() ? first : second;
}

function parseDate(value?: string | null) {
  if (!value) return null;

  const date = new Date(value);

  return Number.isFinite(date.getTime()) ? date : null;
}

export interface SyncBaySnapshotPricingSourceInput {
  capturedAt: Date;
  currency: string | null;
  ebayItemId: string;
  payload: unknown;
  priceAmount: number | null;
  sku: string | null;
  source: string;
  title: string | null;
}

export interface SyncBayPricingSource {
  currency: string | null;
  priceAmount: number | null;
  sku: string | null;
  source: "preview" | "snapshot";
  title: string | null;
}

export function buildSnapshotPricingSourcesByItemId(
  snapshots: SyncBaySnapshotPricingSourceInput[],
) {
  const ebaySources = new Map<string, SyncBayPricingSource>();
  const syncBaySources = new Map<string, SyncBayPricingSource>();
  const sortedSnapshots = [...snapshots].sort(
    (left, right) => right.capturedAt.getTime() - left.capturedAt.getTime(),
  );

  for (const snapshot of sortedSnapshots) {
    const priceAmount = getSnapshotOriginalPriceAmount(snapshot);

    if (priceAmount === null) continue;

    const source = {
      currency: snapshot.currency,
      priceAmount,
      sku: snapshot.sku,
      source: "snapshot" as const,
      title: snapshot.title,
    };

    if (snapshot.source === "EBAY" && !ebaySources.has(snapshot.ebayItemId)) {
      ebaySources.set(snapshot.ebayItemId, source);
    }

    if (
      snapshot.source === "SYNCBAY" &&
      !syncBaySources.has(snapshot.ebayItemId)
    ) {
      syncBaySources.set(snapshot.ebayItemId, source);
    }
  }

  return new Map(
    [...new Set([...syncBaySources.keys(), ...ebaySources.keys()])].map(
      (itemId) => [
        itemId,
        ebaySources.get(itemId) ?? syncBaySources.get(itemId),
      ],
    ),
  );
}

function getSnapshotOriginalPriceAmount(
  snapshot: SyncBaySnapshotPricingSourceInput,
) {
  if (snapshot.source === "EBAY") return normalizeMoneyAmount(snapshot.priceAmount);

  return (
    getJsonNumber(
      getJsonObject(getJsonObject(snapshot.payload)?.pricing)?.ebayPriceAmount,
    ) ?? normalizeMoneyAmount(snapshot.priceAmount)
  );
}

function normalizeMoneyAmount(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function getJsonObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  return value as Record<string, unknown>;
}

function getJsonNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

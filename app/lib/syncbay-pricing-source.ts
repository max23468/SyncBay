export interface SyncBaySnapshotPricingSourceInput {
  capturedAt: Date;
  currency: string | null;
  ebayItemId: string;
  payload: unknown;
  priceAmount: number | null;
  productStatus?: string | null;
  quantity?: number | null;
  sku: string | null;
  source: string;
  title: string | null;
}

export interface SyncBayPricingSource {
  currency: string | null;
  priceAmount: number | null;
  productStatus?: string | null;
  quantity?: number | null;
  sku: string | null;
  source: "preview" | "snapshot";
  title: string | null;
}

export function buildSnapshotPricingSourcesByItemId(
  snapshots: SyncBaySnapshotPricingSourceInput[],
) {
  const sources = new Map<string, SyncBayPricingSource>();
  const sortedSnapshots = [...snapshots].sort(
    (left, right) => right.capturedAt.getTime() - left.capturedAt.getTime(),
  );

  for (const snapshot of sortedSnapshots) {
    const priceAmount = getSnapshotOriginalPriceAmount(snapshot);

    if (priceAmount === null) continue;

    if (sources.has(snapshot.ebayItemId)) continue;

    sources.set(snapshot.ebayItemId, {
      currency: snapshot.currency,
      priceAmount,
      sku: snapshot.sku,
      source: "snapshot" as const,
      title: snapshot.title,
      ...(snapshot.productStatus !== undefined
        ? { productStatus: snapshot.productStatus }
        : {}),
      ...(snapshot.quantity !== undefined
        ? { quantity: snapshot.quantity }
        : {}),
    });
  }

  return sources;
}

function getSnapshotOriginalPriceAmount(
  snapshot: SyncBaySnapshotPricingSourceInput,
) {
  if (snapshot.source === "EBAY")
    return normalizeMoneyAmount(snapshot.priceAmount);

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

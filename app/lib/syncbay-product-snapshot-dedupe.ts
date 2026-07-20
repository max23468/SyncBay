import type { ProductSnapshotSource } from "@prisma/client";

const VOLATILE_PAYLOAD_KEYS = new Set([
  "importJobId",
  "orderLineItemKey",
  "previousQuantity",
  "syncJobId",
]);

type SnapshotComparable = {
  currency?: string | null;
  descriptionHash?: string | null;
  ebayItemId?: string | null;
  imageCount?: number | null;
  payload?: unknown;
  priceAmount?: unknown;
  productStatus?: string | null;
  quantity?: number | null;
  shopifyProductGid?: string | null;
  shopifyVariantGid?: string | null;
  sku?: string | null;
  source?: ProductSnapshotSource | string | null;
  title?: string | null;
};

export function shouldCreateProductSnapshot(input: {
  next: SnapshotComparable;
  previous: SnapshotComparable | null | undefined;
}) {
  if (!input.previous) return true;

  return (
    normalizeSnapshotForComparison(input.next) !== normalizeSnapshotForComparison(input.previous)
  );
}

function normalizeSnapshotForComparison(snapshot: SnapshotComparable) {
  return stableStringify({
    currency: snapshot.currency ?? null,
    descriptionHash: snapshot.descriptionHash ?? null,
    ebayItemId: snapshot.ebayItemId ?? null,
    imageCount: snapshot.imageCount ?? null,
    payload: stripVolatilePayloadKeys(snapshot.payload ?? null),
    priceAmount: normalizeDecimal(snapshot.priceAmount),
    productStatus: snapshot.productStatus ?? null,
    quantity: snapshot.quantity ?? null,
    shopifyProductGid: snapshot.shopifyProductGid ?? null,
    shopifyVariantGid: snapshot.shopifyVariantGid ?? null,
    sku: snapshot.sku ?? null,
    source: snapshot.source ?? null,
    title: snapshot.title ?? null,
  });
}

function normalizeDecimal(value: unknown) {
  if (value === null || value === undefined) return null;

  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) return numericValue.toFixed(2);

  return String(value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entryValue]) => [key, sortValue(entryValue)]),
  );
}

function stripVolatilePayloadKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatilePayloadKeys);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entryValue]) =>
      VOLATILE_PAYLOAD_KEYS.has(key) ? [] : [[key, stripVolatilePayloadKeys(entryValue)] as const],
    ),
  );
}

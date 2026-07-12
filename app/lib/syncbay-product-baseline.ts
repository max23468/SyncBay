export type ProductBaselineValue = string | number | null | string[] | Record<string, string[]>;

export type ProductBaselineState = Record<string, ProductBaselineValue>;
export type ProductBaselinePatch = Record<string, ProductBaselineValue | undefined>;

export function mergeProductBaseline<T extends ProductBaselineState>(
  current: T,
  patch: ProductBaselinePatch,
): T & ProductBaselineState {
  const merged: ProductBaselineState = { ...current };

  for (const [field, value] of Object.entries(patch)) {
    if (value !== undefined) merged[field] = value;
  }

  return merged as T & ProductBaselineState;
}

export function getUtcWeekStart(input: Date) {
  const date = new Date(Date.UTC(
    input.getUTCFullYear(),
    input.getUTCMonth(),
    input.getUTCDate(),
  ));
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return date;
}

const PRODUCT_DISPLAY_FALLBACK_FIELDS = [
  "currency",
  "priceAmount",
  "productStatus",
  "quantity",
  "sku",
  "title",
] as const;

type ProductDisplayFallbackState = {
  capturedAt: Date;
  mappingId: string | null;
  currency: unknown | null;
  priceAmount: unknown | null;
  productStatus: unknown | null;
  quantity: unknown | null;
  sku: unknown | null;
  title: unknown | null;
};

export function mergeProductDisplayBaselineWithSnapshot<
  T extends ProductDisplayFallbackState,
>(baseline: T, snapshot: T | null | undefined): T {
  if (!snapshot) return baseline;

  const merged = { ...baseline };
  for (const field of PRODUCT_DISPLAY_FALLBACK_FIELDS) {
    if (merged[field] === null && snapshot[field] !== null) {
      merged[field] = snapshot[field];
    }
  }
  return merged;
}

export function selectProductDisplaySnapshotQuantity(input: {
  latestCurrency: string | null;
  latestQuantity: number | null;
  stockQuantity: number | null;
}) {
  return input.latestCurrency !== null && input.latestQuantity !== null
    ? input.latestQuantity
    : input.stockQuantity;
}

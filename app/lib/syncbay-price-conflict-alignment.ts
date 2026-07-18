import {
  calculateShopifyPricing,
  normalizeMoneyComparisonCents,
  type PriceRoundingMode,
} from "./syncbay-pricing-rules.ts";
import {
  selectShopifyVariantForSync,
  type ShopifyVariantSelectionCandidate,
} from "./syncbay-shopify-variant-selection.ts";

type PriceConflictValue = {
  amount?: number | string | null;
  compareAtPrice?: number | string | null;
};

export type AlignedPriceConflictRepair = {
  applied: boolean;
  compareAtPrice: string | null;
  compareAtPriceAmount: number | null;
  discountPercent: number;
  ebayPriceAmount: number;
  price: string;
  priceAmount: number;
  roundingMode: PriceRoundingMode;
};

export function getAlignedPriceConflictRepair(input: {
  ebayPriceAmount: number | null;
  field: string;
  latestSyncBayValue: unknown;
  pricingRule: {
    discountPercent: number;
    roundingMode: PriceRoundingMode;
  };
  shopifyValue: unknown;
}): AlignedPriceConflictRepair | null {
  if (input.field !== "price") return null;

  const pricing = calculateShopifyPricing({
    discountPercent: input.pricingRule.discountPercent,
    ebayPriceAmount: input.ebayPriceAmount,
    roundingMode: input.pricingRule.roundingMode,
  });
  const price = formatShopifyMoney(pricing.priceAmount);

  if (
    !price ||
    pricing.priceAmount === null ||
    input.ebayPriceAmount === null
  ) {
    return null;
  }

  const compareAtPrice = formatShopifyMoney(pricing.compareAtPriceAmount);
  const expectedPriceCents = normalizeMoneyComparisonCents(price);
  const expectedCompareAtPriceCents =
    normalizeMoneyComparisonCents(compareAtPrice);
  const shopifyValue = getPriceConflictValue(input.shopifyValue);
  const latestSyncBayValue = getPriceConflictValue(input.latestSyncBayValue);

  if (
    normalizeMoneyComparisonCents(shopifyValue?.amount) !==
      expectedPriceCents ||
    normalizeMoneyComparisonCents(shopifyValue?.compareAtPrice) !==
      expectedCompareAtPriceCents
  ) {
    return null;
  }

  if (
    normalizeMoneyComparisonCents(latestSyncBayValue?.amount) ===
      expectedPriceCents &&
    normalizeMoneyComparisonCents(latestSyncBayValue?.compareAtPrice) ===
      expectedCompareAtPriceCents
  ) {
    return null;
  }

  return {
    applied: pricing.applied,
    compareAtPrice,
    compareAtPriceAmount: pricing.compareAtPriceAmount,
    discountPercent: pricing.discountPercent,
    ebayPriceAmount: input.ebayPriceAmount,
    price,
    priceAmount: pricing.priceAmount,
    roundingMode: pricing.roundingMode,
  };
}

export function buildPriceConflictValue(input: {
  compareAtPrice: number | string | null | undefined;
  price: number | string | null | undefined;
}): PriceConflictValue {
  return {
    amount: formatShopifyMoney(input.price),
    compareAtPrice: formatShopifyMoney(input.compareAtPrice),
  };
}

export function selectPriceConflictRepairVariant<
  Variant extends ShopifyVariantSelectionCandidate,
>(input: { preferredVariantGid?: string | null; variants?: Variant[] | null }) {
  return selectShopifyVariantForSync(input);
}

export function getFinalizedPriceConflictRepairIds(input: {
  conflictIds: string[];
  updatedCount: number;
}) {
  return input.updatedCount === input.conflictIds.length
    ? input.conflictIds
    : [];
}

export function getPriceConflictRepairSnapshotVariantGid(input: {
  latestSnapshotVariantGid?: string | null;
  mappingVariantGid?: string | null;
  selectedVariantGid?: string | null;
}) {
  return (
    input.selectedVariantGid ??
    input.mappingVariantGid ??
    input.latestSnapshotVariantGid ??
    null
  );
}

function getPriceConflictValue(value: unknown): PriceConflictValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;

  return {
    amount: getMoneyValue(candidate.amount),
    compareAtPrice: getMoneyValue(candidate.compareAtPrice),
  };
}

function getMoneyValue(value: unknown) {
  return typeof value === "number" ||
    typeof value === "string" ||
    value === null ||
    value === undefined
    ? value
    : null;
}

function formatShopifyMoney(value: number | string | null | undefined) {
  const cents = normalizeMoneyComparisonCents(value);

  return cents === null ? null : (cents / 100).toFixed(2);
}

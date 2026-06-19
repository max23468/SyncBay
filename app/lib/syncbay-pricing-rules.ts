export const PRICING_DISCOUNT_MIN_PERCENT = 0;
export const PRICING_DISCOUNT_MAX_PERCENT = 90;

export const PRICE_ROUNDING_MODES = ["CENTS", "WHOLE_EURO"] as const;

export type PriceRoundingMode = (typeof PRICE_ROUNDING_MODES)[number];

export interface SyncBayPricingRule {
  discountPercent: number;
  roundingMode: PriceRoundingMode;
}

export function calculateShopifyPricing(input: {
  discountPercent: number;
  ebayPriceAmount: number | null;
  roundingMode: PriceRoundingMode;
}) {
  const originalCents = toMoneyCents(input.ebayPriceAmount);

  if (originalCents === null) {
    return {
      applied: false,
      compareAtPriceAmount: null,
      discountPercent: normalizeDiscountPercent(input.discountPercent) ?? 0,
      priceAmount: null,
      roundingMode: normalizePriceRoundingMode(input.roundingMode),
    };
  }

  const discountPercent = normalizeDiscountPercent(input.discountPercent) ?? 0;
  const roundingMode = normalizePriceRoundingMode(input.roundingMode);

  if (discountPercent <= 0) {
    return {
      applied: false,
      compareAtPriceAmount: null,
      discountPercent,
      priceAmount: centsToAmount(originalCents),
      roundingMode,
    };
  }

  const discountedCents = Math.max(
    1,
    Math.round((originalCents * (100 - discountPercent)) / 100),
  );
  const wholeEuroCents = Math.floor(discountedCents / 100) * 100;
  const roundedCents =
    roundingMode === "WHOLE_EURO" && wholeEuroCents >= 100
      ? wholeEuroCents
      : discountedCents;

  if (roundedCents >= originalCents) {
    return {
      applied: false,
      compareAtPriceAmount: null,
      discountPercent,
      priceAmount: centsToAmount(originalCents),
      roundingMode,
    };
  }

  return {
    applied: true,
    compareAtPriceAmount: centsToAmount(originalCents),
    discountPercent,
    priceAmount: centsToAmount(roundedCents),
    roundingMode,
  };
}

export function normalizePricingRuleFormInput(input: {
  discountPercent: string;
  roundingMode: string;
}):
  | {
      discountPercent: number;
      roundingMode: PriceRoundingMode;
      status: "valid";
    }
  | {
      message: string;
      status: "invalid";
    } {
  const discountPercent = normalizeDiscountPercentInput(input.discountPercent);

  if (discountPercent === null) {
    return {
      message: `Inserisci uno sconto intero tra ${PRICING_DISCOUNT_MIN_PERCENT} e ${PRICING_DISCOUNT_MAX_PERCENT}.`,
      status: "invalid",
    };
  }

  return {
    discountPercent,
    roundingMode: normalizePriceRoundingMode(input.roundingMode),
    status: "valid",
  };
}

export function normalizePriceRoundingMode(
  value: string | null | undefined,
): PriceRoundingMode {
  return value === "WHOLE_EURO" ? "WHOLE_EURO" : "CENTS";
}

function normalizeDiscountPercent(value: number) {
  return Number.isInteger(value) &&
    value >= PRICING_DISCOUNT_MIN_PERCENT &&
    value <= PRICING_DISCOUNT_MAX_PERCENT
    ? value
    : null;
}

function normalizeDiscountPercentInput(value: string) {
  const normalized = value.trim();

  if (!/^\d+$/.test(normalized)) return null;

  return normalizeDiscountPercent(Number.parseInt(normalized, 10));
}

function toMoneyCents(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.round(value * 100);
}

function centsToAmount(cents: number) {
  return cents / 100;
}

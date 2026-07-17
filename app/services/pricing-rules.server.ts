import type { PriceRoundingMode as PrismaPriceRoundingMode } from "@prisma/client";

import prisma from "../db.server";
import {
  normalizePriceRoundingMode,
  type SyncBayPricingRule,
} from "../lib/syncbay-pricing-rules";

export const DEFAULT_PRICING_RULE: SyncBayPricingRule = {
  discountPercent: 0,
  roundingMode: "CENTS",
};

export async function getPricingRuleForShopId(
  shopId: string,
): Promise<SyncBayPricingRule> {
  const pricingRule = await prisma.pricingRule.findUnique({
    select: {
      discountPercent: true,
      roundingMode: true,
    },
    where: { shopId },
  });

  if (!pricingRule) return DEFAULT_PRICING_RULE;

  return normalizePricingRule(pricingRule);
}

export function normalizePricingRule(input: {
  discountPercent: number | null;
  roundingMode: PrismaPriceRoundingMode | string | null;
}): SyncBayPricingRule {
  return {
    discountPercent:
      typeof input.discountPercent === "number" &&
      Number.isInteger(input.discountPercent) &&
      input.discountPercent >= 0 &&
      input.discountPercent <= 90
        ? input.discountPercent
        : DEFAULT_PRICING_RULE.discountPercent,
    roundingMode: normalizePriceRoundingMode(input.roundingMode),
  };
}

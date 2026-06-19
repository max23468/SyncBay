import assert from "node:assert/strict";
import { test } from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { calculateShopifyPricing, normalizePricingRuleFormInput } from "./syncbay-pricing-rules.ts";

test("applies an integer percent discount and keeps eBay price as compare-at price", () => {
  const pricing = calculateShopifyPricing({
    discountPercent: 15,
    ebayPriceAmount: 89.9,
    roundingMode: "CENTS",
  });

  assert.deepEqual(pricing, {
    applied: true,
    compareAtPriceAmount: 89.9,
    discountPercent: 15,
    priceAmount: 76.42,
    roundingMode: "CENTS",
  });
});

test("rounds the discounted Shopify price to the nearest whole euro when requested", () => {
  const pricing = calculateShopifyPricing({
    discountPercent: 15,
    ebayPriceAmount: 89.9,
    roundingMode: "WHOLE_EURO",
  });

  assert.deepEqual(pricing, {
    applied: true,
    compareAtPriceAmount: 89.9,
    discountPercent: 15,
    priceAmount: 76,
    roundingMode: "WHOLE_EURO",
  });
});

test("keeps whole-euro discounted prices below the eBay compare-at price", () => {
  assert.deepEqual(
    calculateShopifyPricing({
      discountPercent: 1,
      ebayPriceAmount: 10,
      roundingMode: "WHOLE_EURO",
    }),
    {
      applied: true,
      compareAtPriceAmount: 10,
      discountPercent: 1,
      priceAmount: 9,
      roundingMode: "WHOLE_EURO",
    },
  );
  assert.deepEqual(
    calculateShopifyPricing({
      discountPercent: 1,
      ebayPriceAmount: 9.99,
      roundingMode: "WHOLE_EURO",
    }),
    {
      applied: true,
      compareAtPriceAmount: 9.99,
      discountPercent: 1,
      priceAmount: 9,
      roundingMode: "WHOLE_EURO",
    },
  );
});

test("falls back to cents when whole-euro rounding would collapse low prices", () => {
  assert.deepEqual(
    calculateShopifyPricing({
      discountPercent: 1,
      ebayPriceAmount: 1,
      roundingMode: "WHOLE_EURO",
    }),
    {
      applied: true,
      compareAtPriceAmount: 1,
      discountPercent: 1,
      priceAmount: 0.99,
      roundingMode: "WHOLE_EURO",
    },
  );
});

test("drops compare-at pricing when rounding leaves no actual discount", () => {
  assert.deepEqual(
    calculateShopifyPricing({
      discountPercent: 1,
      ebayPriceAmount: 0.5,
      roundingMode: "WHOLE_EURO",
    }),
    {
      applied: false,
      compareAtPriceAmount: null,
      discountPercent: 1,
      priceAmount: 0.5,
      roundingMode: "WHOLE_EURO",
    },
  );
});

test("normalizes a free integer discount percent from settings form input", () => {
  assert.deepEqual(
    normalizePricingRuleFormInput({
      discountPercent: "8",
      roundingMode: "WHOLE_EURO",
    }),
    {
      discountPercent: 8,
      roundingMode: "WHOLE_EURO",
      status: "valid",
    },
  );
});

test("rejects decimal or out-of-range discount percent from settings form input", () => {
  assert.deepEqual(
    normalizePricingRuleFormInput({
      discountPercent: "8.5",
      roundingMode: "CENTS",
    }),
    {
      message: "Inserisci uno sconto intero tra 0 e 90.",
      status: "invalid",
    },
  );
  assert.deepEqual(
    normalizePricingRuleFormInput({
      discountPercent: "91",
      roundingMode: "CENTS",
    }),
    {
      message: "Inserisci uno sconto intero tra 0 e 90.",
      status: "invalid",
    },
  );
});

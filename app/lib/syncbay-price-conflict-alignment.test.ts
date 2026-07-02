import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { getAlignedPriceConflictRepair } from "./syncbay-price-conflict-alignment.ts";

test("recognizes a stale SyncBay price baseline when Shopify already matches eBay-derived pricing", () => {
  assert.deepEqual(
    getAlignedPriceConflictRepair({
      ebayPriceAmount: 59,
      field: "price",
      latestSyncBayValue: {
        amount: "63.48",
        compareAtPrice: "69.00",
      },
      pricingRule: {
        discountPercent: 8,
        roundingMode: "CENTS",
      },
      shopifyValue: {
        amount: "54.28",
        compareAtPrice: "59.00",
      },
    }),
    {
      applied: true,
      compareAtPrice: "59.00",
      compareAtPriceAmount: 59,
      discountPercent: 8,
      ebayPriceAmount: 59,
      price: "54.28",
      priceAmount: 54.28,
      roundingMode: "CENTS",
    },
  );
});

test("keeps a real manual Shopify price conflict open", () => {
  assert.equal(
    getAlignedPriceConflictRepair({
      ebayPriceAmount: 59,
      field: "price",
      latestSyncBayValue: {
        amount: "63.48",
        compareAtPrice: "69.00",
      },
      pricingRule: {
        discountPercent: 8,
        roundingMode: "CENTS",
      },
      shopifyValue: {
        amount: "50.00",
        compareAtPrice: "59.00",
      },
    }),
    null,
  );
});

test("does not repair non-price fields or already current baselines", () => {
  assert.equal(
    getAlignedPriceConflictRepair({
      ebayPriceAmount: 59,
      field: "description",
      latestSyncBayValue: {
        amount: "63.48",
        compareAtPrice: "69.00",
      },
      pricingRule: {
        discountPercent: 8,
        roundingMode: "CENTS",
      },
      shopifyValue: {
        amount: "54.28",
        compareAtPrice: "59.00",
      },
    }),
    null,
  );

  assert.equal(
    getAlignedPriceConflictRepair({
      ebayPriceAmount: 59,
      field: "price",
      latestSyncBayValue: {
        amount: "54.28",
        compareAtPrice: "59.00",
      },
      pricingRule: {
        discountPercent: 8,
        roundingMode: "CENTS",
      },
      shopifyValue: {
        amount: "54.28",
        compareAtPrice: "59.00",
      },
    }),
    null,
  );
});

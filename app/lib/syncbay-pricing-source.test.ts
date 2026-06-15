import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildSnapshotPricingSourcesByItemId } from "./syncbay-pricing-source.ts";

test("prefers eBay snapshot prices over newer discounted SyncBay snapshots", () => {
  const sources = buildSnapshotPricingSourcesByItemId([
    {
      capturedAt: new Date("2026-06-15T10:00:00Z"),
      currency: "EUR",
      ebayItemId: "1001",
      payload: {
        pricing: {
          compareAtPriceAmount: 100,
          discountPercent: 8,
          ebayPriceAmount: 100,
          priceAmount: 92,
        },
      },
      priceAmount: 92,
      sku: "SKU-1001",
      source: "SYNCBAY",
      title: "Prodotto scontato",
    },
    {
      capturedAt: new Date("2026-06-14T10:00:00Z"),
      currency: "EUR",
      ebayItemId: "1001",
      payload: {},
      priceAmount: 100,
      sku: "SKU-1001",
      source: "EBAY",
      title: "Prodotto eBay",
    },
  ]);

  assert.deepEqual(sources.get("1001"), {
    currency: "EUR",
    priceAmount: 100,
    sku: "SKU-1001",
    source: "snapshot",
    title: "Prodotto eBay",
  });
});

test("uses the original eBay price stored in SyncBay pricing payloads", () => {
  const sources = buildSnapshotPricingSourcesByItemId([
    {
      capturedAt: new Date("2026-06-15T10:00:00Z"),
      currency: "EUR",
      ebayItemId: "1002",
      payload: {
        pricing: {
          ebayPriceAmount: 50,
          priceAmount: 46,
        },
      },
      priceAmount: 46,
      sku: "SKU-1002",
      source: "SYNCBAY",
      title: "Prodotto pricing-only",
    },
  ]);

  assert.deepEqual(sources.get("1002"), {
    currency: "EUR",
    priceAmount: 50,
    sku: "SKU-1002",
    source: "snapshot",
    title: "Prodotto pricing-only",
  });
});

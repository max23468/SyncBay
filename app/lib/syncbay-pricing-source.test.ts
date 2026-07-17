import assert from "node:assert/strict";
import test from "node:test";

import { buildSnapshotPricingSourcesByItemId } from "./syncbay-pricing-source.ts";

test("uses newer SyncBay pricing baselines before stale eBay snapshots", () => {
  const sources = buildSnapshotPricingSourcesByItemId([
    {
      capturedAt: new Date("2026-06-15T10:00:00Z"),
      currency: "EUR",
      ebayItemId: "1001",
      payload: {
        pricing: {
          compareAtPriceAmount: 120,
          discountPercent: 8,
          ebayPriceAmount: 120,
          priceAmount: 110.4,
        },
      },
      priceAmount: 110.4,
      sku: "SKU-1001",
      source: "SYNCBAY",
      title: "Prodotto scontato",
    },
    {
      capturedAt: new Date("2026-06-14T10:00:00Z"),
      currency: "EUR",
      ebayItemId: "1001",
      payload: {},
      priceAmount: 80,
      sku: "SKU-1001",
      source: "EBAY",
      title: "Prodotto eBay",
    },
  ]);

  assert.deepEqual(sources.get("1001"), {
    currency: "EUR",
    priceAmount: 120,
    sku: "SKU-1001",
    source: "snapshot",
    title: "Prodotto scontato",
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

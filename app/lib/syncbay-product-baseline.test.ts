import assert from "node:assert/strict";
import test from "node:test";

import * as productBaseline from "./syncbay-product-baseline.ts";

const {
  mergeProductBaseline,
  mergeProductDisplayBaselineWithSnapshot,
  selectProductDisplaySnapshotQuantity,
} = productBaseline;

test("merges partial baseline patches without clearing absent fields", () => {
  assert.deepEqual(
    mergeProductBaseline(
      { title: "Titolo", quantity: 3, imageCount: 2 },
      { title: undefined, quantity: 2, imageCount: null },
    ),
    { title: "Titolo", quantity: 2, imageCount: null },
  );
});

test("adds fields supplied by a patch and preserves explicit null", () => {
  assert.deepEqual(
    mergeProductBaseline(
      { title: null, quantity: null },
      { title: "Nuovo", quantity: undefined, currency: "EUR" },
    ),
    { title: "Nuovo", quantity: null, currency: "EUR" },
  );
});

test("fills every missing display field from snapshot history", () => {
  const capturedAt = new Date("2026-07-12T20:40:00Z");
  assert.deepEqual(
    mergeProductDisplayBaselineWithSnapshot(
      {
        capturedAt,
        currency: "EUR",
        mappingId: "mapping-1",
        priceAmount: null,
        productStatus: null,
        quantity: 4,
        sku: null,
        title: null,
      },
      {
        capturedAt: new Date("2026-07-01T10:00:00Z"),
        currency: "EUR",
        mappingId: "mapping-1",
        priceAmount: "12.50",
        productStatus: "ACTIVE",
        quantity: 3,
        sku: "SKU-1",
        title: "Titolo storico",
      },
    ),
    {
      capturedAt,
      currency: "EUR",
      mappingId: "mapping-1",
      priceAmount: "12.50",
      productStatus: "ACTIVE",
      quantity: 4,
      sku: "SKU-1",
      title: "Titolo storico",
    },
  );
});

test("uses older currency-backed stock when the newest snapshot has no quantity", () => {
  assert.equal(
    selectProductDisplaySnapshotQuantity({
      latestCurrency: "EUR",
      latestQuantity: null,
      stockQuantity: 6,
    }),
    6,
  );
  assert.equal(
    selectProductDisplaySnapshotQuantity({
      latestCurrency: "EUR",
      latestQuantity: 4,
      stockQuantity: 6,
    }),
    4,
  );
});

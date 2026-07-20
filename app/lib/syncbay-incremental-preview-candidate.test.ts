import assert from "node:assert/strict";
import { test } from "vitest";

import {
  deserializeIncrementalPreviewCandidate,
  serializeIncrementalPreviewCandidate,
} from "./syncbay-incremental-preview-candidate.ts";

test("round-trips store category fields through the SYNC_INCREMENTAL job payload", () => {
  const candidate = {
    currency: "EUR",
    descriptionHtml: null,
    imageUrls: ["https://i.ebayimg.example/one.jpg"],
    itemId: "157963442050",
    itemSpecifics: [
      { name: "Materiale", values: ["Argento"] },
      { name: "Conservazione", values: ["FDC"] },
    ],
    priceAmount: 0.99,
    quantity: 1,
    sku: "NL-VEIII-1942",
    skuGenerated: false,
    storeCategoryId: "31415",
    storeCategoryName: "Italia Regno - Vittorio Emanuele III",
    title: "Italia 5 Centesimi Impero 1942",
    variantCount: 1,
  };
  const serialized = serializeIncrementalPreviewCandidate(candidate);

  assert.equal(serialized.storeCategoryId, "31415");
  assert.deepEqual(serialized.itemSpecifics, [
    { name: "Materiale", values: ["Argento"] },
    { name: "Conservazione", values: ["FDC"] },
  ]);
  assert.equal(serialized.storeCategoryName, "Italia Regno - Vittorio Emanuele III");

  const deserialized = deserializeIncrementalPreviewCandidate(serialized);

  assert.deepEqual(deserialized, candidate);
});

test("normalizes missing store category fields to null without dropping the itemId", () => {
  const serialized = serializeIncrementalPreviewCandidate({
    itemId: "168200000000",
  });

  assert.equal(serialized.storeCategoryId, null);
  assert.equal(serialized.storeCategoryName, null);

  const deserialized = deserializeIncrementalPreviewCandidate(serialized);

  assert.equal(deserialized?.itemId, "168200000000");
  assert.equal(deserialized?.storeCategoryId, null);
  assert.equal(deserialized?.storeCategoryName, null);
});

test("rejects payloads without a stable itemId", () => {
  assert.equal(deserializeIncrementalPreviewCandidate(null), null);
  assert.equal(deserializeIncrementalPreviewCandidate({}), null);
  assert.equal(deserializeIncrementalPreviewCandidate({ itemId: 12345 }), null);
});

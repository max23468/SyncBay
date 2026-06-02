import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { getKeepShopifyDescriptionHash } from "./syncbay-keep-shopify-baseline.ts";

test("uses the Shopify value when keeping a description conflict", () => {
  assert.equal(
    getKeepShopifyDescriptionHash({
      conflictField: "description",
      latestDescriptionBaselineHash: "previous-description-hash",
      shopifyValue: "kept-description-hash",
      snapshotDescriptionHash: null,
    }),
    "kept-description-hash",
  );
});

test("preserves the latest real description baseline for non-description conflicts", () => {
  assert.equal(
    getKeepShopifyDescriptionHash({
      conflictField: "quantity",
      latestDescriptionBaselineHash: "previous-description-hash",
      shopifyValue: 7,
      snapshotDescriptionHash: null,
    }),
    "previous-description-hash",
  );
});

test("prefers the selected snapshot description when it is already present", () => {
  assert.equal(
    getKeepShopifyDescriptionHash({
      conflictField: "quantity",
      latestDescriptionBaselineHash: "previous-description-hash",
      shopifyValue: 7,
      snapshotDescriptionHash: "selected-snapshot-description-hash",
    }),
    "selected-snapshot-description-hash",
  );
});

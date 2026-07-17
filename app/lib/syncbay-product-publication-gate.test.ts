import assert from "node:assert/strict";
import test from "node:test";

import { canPublishProductAfterInventorySync } from "./syncbay-product-publication-gate.ts";

test("publishes active products only after inventory sync succeeds", () => {
  assert.equal(
    canPublishProductAfterInventorySync({
      inventorySyncStatus: "synced",
      productStatus: "ACTIVE",
    }),
    true,
  );
  assert.equal(
    canPublishProductAfterInventorySync({
      inventorySyncStatus: "failed",
      productStatus: "ACTIVE",
    }),
    false,
  );
  assert.equal(
    canPublishProductAfterInventorySync({
      inventorySyncStatus: "skipped",
      productStatus: "ACTIVE",
    }),
    false,
  );
});

test("does not require inventory sync before non-active publication checks", () => {
  assert.equal(
    canPublishProductAfterInventorySync({
      inventorySyncStatus: "skipped",
      productStatus: "DRAFT",
    }),
    true,
  );
});

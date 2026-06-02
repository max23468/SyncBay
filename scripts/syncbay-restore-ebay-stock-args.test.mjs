import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRestoreEbayStockArgs,
  shouldCreateRestoreSnapshot,
} from "./syncbay-restore-ebay-stock-args.mjs";

test("parses explicit skip snapshot flag for external eBay stock test writes", () => {
  const args = parseRestoreEbayStockArgs([
    "--item-id",
    "156986744184",
    "--quantity",
    "2",
    "--confirm-real-ebay-write",
    "--skip-snapshot",
    "--reason",
    "external_ebay_change_for_sync_test",
  ]);

  assert.equal(args.itemId, "156986744184");
  assert.equal(args.quantity, "2");
  assert.equal(args.confirmRealEbayWrite, true);
  assert.equal(args.skipSnapshot, true);
  assert.equal(args.reason, "external_ebay_change_for_sync_test");
  assert.equal(shouldCreateRestoreSnapshot(args), false);
});

test("creates restore snapshot by default", () => {
  const args = parseRestoreEbayStockArgs([
    "--item-id",
    "156986744184",
    "--quantity",
    "3",
    "--confirm-real-ebay-write",
  ]);

  assert.equal(args.skipSnapshot, false);
  assert.equal(shouldCreateRestoreSnapshot(args), true);
});

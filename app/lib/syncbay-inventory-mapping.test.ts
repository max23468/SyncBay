import assert from "node:assert/strict";
import { test } from "vitest";

import { getPersistableInventoryItemGid } from "./syncbay-inventory-mapping.ts";

test("keeps an inventory item gid from synced or failed inventory results", () => {
  assert.equal(
    getPersistableInventoryItemGid({
      inventoryItemGid: " gid://shopify/InventoryItem/1 ",
      status: "synced",
    }),
    "gid://shopify/InventoryItem/1",
  );
  assert.equal(
    getPersistableInventoryItemGid({
      inventoryItemGid: "gid://shopify/InventoryItem/2",
      status: "failed",
    }),
    "gid://shopify/InventoryItem/2",
  );
  assert.equal(getPersistableInventoryItemGid({ status: "skipped" }), null);
});

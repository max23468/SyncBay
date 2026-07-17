import assert from "node:assert/strict";
import test from "node:test";

import { hasEffectiveShopifyScope } from "./syncbay-shopify-scopes.ts";

test("treats Shopify write scopes as satisfying matching read scopes", () => {
  const scopes = [
    "write_files",
    "write_inventory",
    "write_locations",
    "write_orders",
    "write_products",
    "write_publications",
  ];

  assert.equal(hasEffectiveShopifyScope(scopes, "read_files"), true);
  assert.equal(hasEffectiveShopifyScope(scopes, "read_inventory"), true);
  assert.equal(hasEffectiveShopifyScope(scopes, "read_locations"), true);
  assert.equal(hasEffectiveShopifyScope(scopes, "read_orders"), true);
  assert.equal(hasEffectiveShopifyScope(scopes, "read_products"), true);
  assert.equal(hasEffectiveShopifyScope(scopes, "read_publications"), true);
});

test("does not treat read scopes as satisfying write scopes", () => {
  assert.equal(hasEffectiveShopifyScope(["read_files"], "write_files"), false);
});

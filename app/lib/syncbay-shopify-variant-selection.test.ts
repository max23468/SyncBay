import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { selectShopifyVariantForSync } from "./syncbay-shopify-variant-selection.ts";

test("selects the persisted mapped variant instead of the first product variant", () => {
  const selected = selectShopifyVariantForSync({
    preferredVariantGid: "gid://shopify/ProductVariant/target",
    variants: [
      { id: "gid://shopify/ProductVariant/first" },
      { id: "gid://shopify/ProductVariant/target" },
    ],
  });

  assert.deepEqual(selected, {
    id: "gid://shopify/ProductVariant/target",
  });
});

test("does not fall back to the first variant when a preferred variant is missing", () => {
  const selected = selectShopifyVariantForSync({
    preferredVariantGid: "gid://shopify/ProductVariant/missing",
    variants: [{ id: "gid://shopify/ProductVariant/first" }],
  });

  assert.equal(selected, null);
});

test("falls back to the first variant only when no preferred variant is stored", () => {
  const selected = selectShopifyVariantForSync({
    preferredVariantGid: null,
    variants: [{ id: "gid://shopify/ProductVariant/first" }],
  });

  assert.deepEqual(selected, {
    id: "gid://shopify/ProductVariant/first",
  });
});

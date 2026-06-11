import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { shouldUseMappedShopifyVariant } from "./syncbay-sold-out-variant.ts";

test("uses the mapped Shopify variant when the mapping stores one", () => {
  assert.equal(
    shouldUseMappedShopifyVariant({
      mappedVariantGid: "gid://shopify/ProductVariant/123",
    }),
    true,
  );
});

test("falls back to product lookup only when no mapped variant is stored", () => {
  assert.equal(
    shouldUseMappedShopifyVariant({ mappedVariantGid: null }),
    false,
  );
  assert.equal(
    shouldUseMappedShopifyVariant({ mappedVariantGid: "   " }),
    false,
  );
});

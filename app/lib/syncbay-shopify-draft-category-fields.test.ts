import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildShopifyDraftCategoryFields, type ShopifyDraftCategoryFields } from "./syncbay-shopify-draft-category-fields.ts";
import type { ShopifyCategoryProposal } from "./syncbay-shopify-category-mapping";

function buildProposal(
  input: Partial<ShopifyCategoryProposal>,
): ShopifyCategoryProposal {
  return {
    applied: false,
    confidence: "high",
    productType: "Monete italiane",
    reason: "dry_run_only",
    shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-2-2-3",
    shopifyCategoryName: "Rare Coins",
    source: "ebay_primary_category",
    ...input,
  };
}

test("builds Shopify draft category fields for a valid category proposal", () => {
  const fields = buildShopifyDraftCategoryFields(buildProposal({}));

  assert.deepEqual(fields, {
    category: "gid://shopify/TaxonomyCategory/ae-2-2-2-2-3",
    productType: "Monete italiane",
  } satisfies ShopifyDraftCategoryFields);
});

test("skips Shopify draft category fields for low-confidence proposals", () => {
  const fields = buildShopifyDraftCategoryFields(
    buildProposal({
      confidence: "low",
      productType: "Collezionismo",
      reason: "low_confidence",
      shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2",
      shopifyCategoryName: "Collectibles",
      source: "fallback",
    }),
  );

  assert.deepEqual(fields, {});
});

test("skips Shopify draft category fields without a Shopify taxonomy category", () => {
  const fields = buildShopifyDraftCategoryFields(
    buildProposal({
      shopifyCategoryGid: null,
      shopifyCategoryName: null,
    }),
  );

  assert.deepEqual(fields, {});
});

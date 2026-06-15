import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildCategoryApplyPlan, buildCategoryBackfillReport } from "./syncbay-category-backfill-report.ts";

const rareCoinsProposal = {
  applied: false,
  confidence: "high" as const,
  productType: "Monete italiane",
  reason: "dry_run_only" as const,
  shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-2-2-3",
  shopifyCategoryName: "Rare Coins",
  source: "ebay_primary_category" as const,
} as const;

test("classifies category backfill rows without applying changes", () => {
  const report = buildCategoryBackfillReport({
    rows: [
      {
        ebayItemId: "1",
        proposal: rareCoinsProposal,
        shopifyCategoryGid: null,
        shopifyProductGid: "gid://shopify/Product/1",
        shopifyProductType: null,
      },
      {
        ebayItemId: "2",
        proposal: rareCoinsProposal,
        shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-2-2-3",
        shopifyProductGid: "gid://shopify/Product/2",
        shopifyProductType: "Monete italiane",
      },
      {
        ebayItemId: "3",
        proposal: rareCoinsProposal,
        shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-2",
        shopifyProductGid: "gid://shopify/Product/3",
        shopifyProductType: "Collezionismo numismatico",
      },
      {
        ebayItemId: "4",
        proposal: {
          ...rareCoinsProposal,
          confidence: "low",
          reason: "low_confidence",
          shopifyCategoryGid: null,
          shopifyCategoryName: null,
        },
        shopifyCategoryGid: null,
        shopifyProductGid: "gid://shopify/Product/4",
        shopifyProductType: null,
      },
    ],
    shopDomain: "syncbay-dev.myshopify.com",
  });

  assert.deepEqual(report.summary, {
    alreadyCorrect: 1,
    applicable: 1,
    conflictsManual: 1,
    ebayLookupFailed: 0,
    missingShopifyProduct: 0,
    total: 4,
    uncertain: 1,
  });
  assert.deepEqual(
    report.rows.map((row) => row.status),
    ["applicable", "already_correct", "conflict_manual", "uncertain"],
  );
  assert.deepEqual(report.proposedCategories, [
    {
      count: 3,
      shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-2-2-3",
      shopifyCategoryName: "Rare Coins",
    },
  ]);
});

test("keeps rows without Shopify products or eBay data out of applicable changes", () => {
  const report = buildCategoryBackfillReport({
    rows: [
      {
        ebayItemId: "1",
        proposal: rareCoinsProposal,
        shopifyCategoryGid: null,
        shopifyProductGid: null,
        shopifyProductType: null,
      },
      {
        ebayItemId: "2",
        lookupFailureReason: "Listing non trovato.",
        lookupFailed: true,
        proposal: null,
        shopifyCategoryGid: null,
        shopifyProductGid: "gid://shopify/Product/2",
        shopifyProductType: null,
      },
    ],
    shopDomain: "syncbay-dev.myshopify.com",
  });

  assert.deepEqual(
    report.rows.map((row) => row.status),
    ["missing_shopify_product", "ebay_lookup_failed"],
  );
  assert.equal(report.summary.applicable, 0);
  assert.equal(report.rows[1]?.lookupFailureReason, "Listing non trovato.");
});

test("uses a valid local proposal even when eBay lookup failed", () => {
  const report = buildCategoryBackfillReport({
    rows: [
      {
        ebayItemId: "1",
        lookupFailed: true,
        proposal: rareCoinsProposal,
        shopifyCategoryGid: null,
        shopifyProductGid: "gid://shopify/Product/1",
        shopifyProductType: null,
      },
      {
        ebayItemId: "2",
        lookupFailed: true,
        proposal: rareCoinsProposal,
        shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-2-2-3",
        shopifyProductGid: "gid://shopify/Product/2",
        shopifyProductType: "Monete italiane",
      },
    ],
    shopDomain: "syncbay-dev.myshopify.com",
  });

  assert.deepEqual(
    report.rows.map((row) => row.status),
    ["applicable", "already_correct"],
  );
  assert.equal(report.summary.ebayLookupFailed, 0);
});

test("builds an apply plan only from applicable category rows", () => {
  const report = buildCategoryBackfillReport({
    rows: [
      {
        ebayItemId: "1",
        proposal: rareCoinsProposal,
        shopifyCategoryGid: null,
        shopifyProductGid: "gid://shopify/Product/1",
        shopifyProductType: null,
      },
      {
        ebayItemId: "2",
        proposal: rareCoinsProposal,
        shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-2-2-3",
        shopifyProductGid: "gid://shopify/Product/2",
        shopifyProductType: "Monete italiane",
      },
      {
        ebayItemId: "3",
        proposal: rareCoinsProposal,
        shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-2",
        shopifyProductGid: "gid://shopify/Product/3",
        shopifyProductType: "Collezionismo numismatico",
      },
    ],
    shopDomain: "syncbay-dev.myshopify.com",
  });

  assert.deepEqual(buildCategoryApplyPlan(report), {
    rows: [
      {
        ebayItemId: "1",
        productType: "Monete italiane",
        shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-2-2-3",
        shopifyProductGid: "gid://shopify/Product/1",
      },
    ],
    skipped: {
      alreadyCorrect: 1,
      conflictsManual: 1,
      ebayLookupFailed: 0,
      missingShopifyProduct: 0,
      uncertain: 0,
    },
  });
});

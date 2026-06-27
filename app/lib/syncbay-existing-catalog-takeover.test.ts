import assert from "node:assert/strict";
import test from "node:test";

import type { ImportPreviewItem } from "../services/import-preview.server";
import type { ExistingProductMatchSuggestion } from "./syncbay-product-matching";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as existingCatalogTakeover from "./syncbay-existing-catalog-takeover.ts";

const { buildExistingCatalogTakeoverReport } = existingCatalogTakeover;

test("marks one auto-linkable valid row as applicable", () => {
  const report = buildExistingCatalogTakeoverReport({
    items: [
      makePreviewItem({
        itemId: "1001",
        matchSuggestions: [
          {
            autoLinkable: true,
            confidence: "high",
            productGid: "gid://shopify/Product/1",
            reasonCodes: ["sku_exact"],
            reasons: ["SKU identico"],
            score: 100,
            variantGid: "gid://shopify/ProductVariant/1",
          },
        ],
        priceAmount: 12,
        quantity: 1,
      }),
    ],
    shopDomain: "example.myshopify.com",
  });

  assert.equal(report.summary.applicable, 1);
  assert.equal(report.rows[0]?.status, "applicabile");
  assert.deepEqual(report.rows[0]?.plannedOperations, [
    "claim_mapping",
    "sync_title",
    "sync_description",
    "sync_price",
    "sync_quantity",
    "sync_category",
    "sync_facets",
    "sync_seo",
    "add_syncbay_tag",
    "preserve_handle",
  ]);
});

test("marks title-only matches as review", () => {
  const report = buildExistingCatalogTakeoverReport({
    items: [
      makePreviewItem({
        itemId: "1002",
        matchSuggestions: [
          {
            autoLinkable: false,
            confidence: "medium",
            productGid: "gid://shopify/Product/2",
            reasonCodes: ["title_very_similar"],
            reasons: ["Titolo molto simile"],
            score: 40,
            variantGid: "gid://shopify/ProductVariant/2",
          },
        ],
        priceAmount: 15,
        quantity: 1,
      }),
    ],
    shopDomain: "example.myshopify.com",
  });

  assert.equal(report.summary.review, 1);
  assert.equal(report.rows[0]?.status, "da_rivedere");
  assert.ok(report.rows[0]?.reasons.includes("match_non_automatico"));
});

test("blocks invalid price and complex variants", () => {
  const report = buildExistingCatalogTakeoverReport({
    items: [
      makePreviewItem({
        itemId: "1003",
        issueCodes: ["invalid_price", "complex_variants"],
        matchSuggestions: [],
        priceAmount: null,
        quantity: 1,
      }),
    ],
    shopDomain: "example.myshopify.com",
  });

  assert.equal(report.summary.blocked, 1);
  assert.equal(report.rows[0]?.status, "bloccante");
  assert.deepEqual(report.rows[0]?.reasons, [
    "prezzo_ebay_non_valido",
    "varianti_non_supportate",
    "match_shopify_mancante",
  ]);
});

function makePreviewItem(input: {
  issueCodes?: string[];
  itemId: string;
  matchSuggestions?: ExistingProductMatchSuggestion[];
  priceAmount?: number | null;
  quantity?: number | null;
}): ImportPreviewItem {
  const issueCodes = input.issueCodes ?? [];

  return {
    itemId: input.itemId,
    issues: issueCodes.map((code) => ({
      code,
      message: code,
      severity: code === "missing_images" ? "warning" : "error",
    })),
    matchSuggestions: input.matchSuggestions ?? [],
    normalized: {
      categoryProposal: {
        applied: false,
        confidence: "high",
        productType: "Monete da collezione",
        reason: "dry_run_only",
        shopifyCategoryGid: "gid://shopify/TaxonomyCategory/1",
        shopifyCategoryName: "Collectible Coins",
        source: "title",
      },
      currency: "EUR",
      descriptionCleanedLength: 12,
      descriptionCleanedTextExcerpt: "Descrizione",
      descriptionHtml: "<p>Descrizione</p>",
      descriptionMode: "CLEAN_HTML",
      descriptionOriginalLength: 12,
      descriptionOriginalTextExcerpt: "Descrizione",
      descriptionRemovedPercent: 0,
      descriptionTemplateSignalCount: 0,
      descriptionWasChanged: false,
      ebayPrimaryCategoryId: "111",
      ebayPrimaryCategoryName: "Monete",
      ebayPrimaryCategoryPath: "Collezionismo > Monete",
      imageCount: 1,
      imageUrls: ["https://example.invalid/syncbay/test.jpg"],
      priceAmount: input.priceAmount ?? 10,
      productFacets: [],
      productStatus: "published",
      qualityChecklist: [],
      qualitySummary: "nessun blocco",
      quantity: input.quantity ?? 1,
      sku: `SKU-${input.itemId}`,
      skuGenerated: false,
      storeCategoryId: "222",
      storeCategoryName: "Numismatica",
      title: `Prodotto ${input.itemId}`,
    },
    status: issueCodes.some((code) => code !== "missing_images")
      ? "error"
      : "importable",
  };
}

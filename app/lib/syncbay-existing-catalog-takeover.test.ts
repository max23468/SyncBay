import assert from "node:assert/strict";
import { test } from "vitest";

import type { ImportPreviewItem } from "../services/import-preview.server";
import type { ExistingProductMatchSuggestion } from "./syncbay-product-matching";

import * as existingCatalogTakeover from "./syncbay-existing-catalog-takeover.ts";

const {
  buildExistingCatalogTakeoverApplyPlan,
  buildExistingCatalogTakeoverReport,
} = existingCatalogTakeover;

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

test("allows strong matches when only the category proposal is uncertain", () => {
  const report = buildExistingCatalogTakeoverReport({
    items: [
      makePreviewItem({
        categoryConfidence: "low",
        itemId: "1007",
        matchSuggestions: [
          makeAutoMatch({
            productGid: "gid://shopify/Product/7",
            shopifyImageCount: 2,
            variantGid: "gid://shopify/ProductVariant/77",
          }),
        ],
        priceAmount: 12,
        quantity: 1,
      }),
    ],
    shopDomain: "example.myshopify.com",
  });

  assert.equal(report.summary.applicable, 1);
  assert.equal(report.summary.review, 0);
  assert.equal(report.rows[0]?.status, "applicabile");
  assert.ok(!report.rows[0]?.reasons.includes("categoria_incerta"));
  assert.deepEqual(report.rows[0]?.plannedOperations, [
    "claim_mapping",
    "sync_title",
    "sync_description",
    "sync_price",
    "sync_quantity",
    "sync_facets",
    "sync_seo",
    "add_syncbay_tag",
    "preserve_handle",
  ]);
});

test("allows image-preserving rows with missing eBay photos", () => {
  const report = buildExistingCatalogTakeoverReport({
    items: [
      makePreviewItem({
        imageCount: 0,
        issueCodes: ["missing_images"],
        itemId: "1005",
        matchSuggestions: [
          makeAutoMatch({
            productGid: "gid://shopify/Product/5",
            shopifyImageCount: 2,
            variantGid: "gid://shopify/ProductVariant/55",
          }),
        ],
        priceAmount: 12,
        quantity: 1,
      }),
    ],
    shopDomain: "example.myshopify.com",
  });

  assert.equal(report.summary.applicable, 1);
  assert.equal(report.rows[0]?.status, "applicabile");
  assert.equal(report.rows[0]?.fieldPolicy.images.operation, "preserve");
  assert.ok(!report.rows[0]?.reasons.includes("immagini_mancanti"));
});

test("keeps missing eBay photos in review when Shopify has no images to preserve", () => {
  const report = buildExistingCatalogTakeoverReport({
    items: [
      makePreviewItem({
        imageCount: 0,
        issueCodes: ["missing_images"],
        itemId: "1006",
        matchSuggestions: [
          makeAutoMatch({
            productGid: "gid://shopify/Product/6",
            shopifyImageCount: 0,
            variantGid: "gid://shopify/ProductVariant/66",
          }),
        ],
        priceAmount: 12,
        quantity: 1,
      }),
    ],
    shopDomain: "example.myshopify.com",
  });

  assert.equal(report.summary.review, 1);
  assert.equal(report.rows[0]?.status, "da_rivedere");
  assert.equal(
    report.rows[0]?.fieldPolicy.images.operation,
    "sync_from_ebay_if_available",
  );
  assert.ok(report.rows[0]?.reasons.includes("immagini_mancanti"));
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

test("keeps weak matches with uncertain categories in review", () => {
  const report = buildExistingCatalogTakeoverReport({
    items: [
      makePreviewItem({
        categoryConfidence: "low",
        itemId: "1008",
        matchSuggestions: [
          {
            autoLinkable: false,
            confidence: "medium",
            productGid: "gid://shopify/Product/8",
            reasonCodes: ["title_very_similar"],
            reasons: ["Titolo molto simile"],
            score: 40,
            variantGid: "gid://shopify/ProductVariant/88",
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
  assert.deepEqual(report.rows[0]?.reasons, [
    "categoria_incerta",
    "match_non_automatico",
  ]);
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

test("builds a reuse-only apply plan from applicable rows only", () => {
  const report = buildExistingCatalogTakeoverReport({
    items: [
      makePreviewItem({
        itemId: "1001",
        matchSuggestions: [
          makeAutoMatch({
            productGid: "gid://shopify/Product/1",
            variantGid: "gid://shopify/ProductVariant/11",
          }),
        ],
        priceAmount: 12,
        quantity: 1,
      }),
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
            variantGid: "gid://shopify/ProductVariant/22",
          },
        ],
        priceAmount: 15,
        quantity: 1,
      }),
    ],
    shopDomain: "example.myshopify.com",
  });

  const plan = buildExistingCatalogTakeoverApplyPlan(report);

  assert.equal(plan.blockers.length, 0);
  assert.deepEqual(plan.ebayItemIds, ["1001"]);
  assert.equal(plan.rows.length, 1);
  assert.deepEqual(plan.rows[0], {
    fieldPolicy: {
      handle: {
        currentHandle: null,
        operation: "preserve",
        redirectRequired: false,
      },
      images: {
        operation: "sync_from_ebay_if_available",
      },
      tags: {
        add: ["Negozio eBay"],
        preserve: [],
        remove: [],
      },
    },
    itemId: "1001",
    productGid: "gid://shopify/Product/1",
    sku: "SKU-1001",
    variantGid: "gid://shopify/ProductVariant/11",
  });
});

test("adds field policies to takeover rows from Shopify match metadata", () => {
  const report = buildExistingCatalogTakeoverReport({
    items: [
      makePreviewItem({
        itemId: "1004",
        matchSuggestions: [
          {
            ...makeAutoMatch({
              productGid: "gid://shopify/Product/4",
              variantGid: "gid://shopify/ProductVariant/44",
            }),
            currentHandle: "moneta-rara-1004",
            currentTags: ["Vecchia app", "Monete rare"],
            shopifyImageCount: 0,
          },
        ],
        priceAmount: 12,
        quantity: 1,
      }),
    ],
    legacyTagsToRemove: ["Vecchia app"],
    shopDomain: "example.myshopify.com",
  });

  assert.deepEqual(report.rows[0]?.fieldPolicy, {
    handle: {
      currentHandle: "moneta-rara-1004",
      operation: "preserve",
      redirectRequired: false,
    },
    images: {
      operation: "sync_from_ebay_if_available",
    },
    tags: {
      add: ["Negozio eBay"],
      preserve: ["Monete rare"],
      remove: ["Vecchia app"],
    },
  });
});

test("blocks apply while the dry-run still has blocking rows", () => {
  const report = buildExistingCatalogTakeoverReport({
    items: [
      makePreviewItem({
        itemId: "1003",
        issueCodes: ["invalid_price"],
        matchSuggestions: [
          makeAutoMatch({
            productGid: "gid://shopify/Product/3",
            variantGid: "gid://shopify/ProductVariant/33",
          }),
        ],
        priceAmount: null,
        quantity: 1,
      }),
    ],
    shopDomain: "example.myshopify.com",
  });

  const plan = buildExistingCatalogTakeoverApplyPlan(report);

  assert.deepEqual(plan.ebayItemIds, []);
  assert.deepEqual(plan.rows, []);
  assert.deepEqual(plan.blockers, [
    "Il dry-run catalogo esistente contiene 1 righe bloccanti da risolvere prima dell'apply.",
  ]);
});

function makePreviewItem(input: {
  categoryConfidence?: "high" | "medium" | "low";
  imageCount?: number;
  issueCodes?: string[];
  itemId: string;
  matchSuggestions?: ExistingProductMatchSuggestion[];
  priceAmount?: number | null;
  quantity?: number | null;
}): ImportPreviewItem {
  const issueCodes = input.issueCodes ?? [];
  const imageCount = input.imageCount ?? 1;

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
        confidence: input.categoryConfidence ?? "high",
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
      imageCount,
      imageUrls:
        imageCount > 0 ? ["https://example.invalid/syncbay/test.jpg"] : [],
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

function makeAutoMatch(input: {
  productGid: string;
  shopifyImageCount?: number;
  variantGid: string;
}): ExistingProductMatchSuggestion {
  return {
    autoLinkable: true,
    confidence: "high",
    productGid: input.productGid,
    reasonCodes: ["sku_exact"],
    reasons: ["SKU identico"],
    score: 100,
    shopifyImageCount: input.shopifyImageCount ?? 0,
    variantGid: input.variantGid,
  };
}

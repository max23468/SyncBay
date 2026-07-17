import assert from "node:assert/strict";
import test from "node:test";

import * as productMatching from "./syncbay-product-matching.ts";

const { buildExistingProductMatchSuggestions, getMatchSuggestionSummary } =
  productMatching;

test("suggests exact sku matches before title matches", () => {
  const suggestions = buildExistingProductMatchSuggestions({
    ebay: {
      itemId: "123456",
      sku: "COIN-001",
      title: "Moneta argento Regno Italia 1901",
    },
    shopifyProducts: [
      {
        barcode: null,
        productGid: "gid://shopify/Product/1",
        sku: "ALT-001",
        title: "Moneta argento Regno Italia",
        variantGid: "gid://shopify/ProductVariant/1",
      },
      {
        barcode: null,
        productGid: "gid://shopify/Product/2",
        sku: "COIN-001",
        title: "Scheda generica",
        variantGid: "gid://shopify/ProductVariant/2",
      },
    ],
  });

  assert.equal(suggestions[0]?.productGid, "gid://shopify/Product/2");
  assert.equal(suggestions[0]?.confidence, "high");
  assert.deepEqual(suggestions[0]?.reasons, ["SKU identico"]);
  assert.equal(suggestions[1]?.confidence, "medium");
});

test("uses item id references as conservative match signals", () => {
  const suggestions = buildExistingProductMatchSuggestions({
    ebay: { itemId: "987654", sku: null, title: "Catalogo monete" },
    shopifyProducts: [
      {
        barcode: "987654",
        productGid: "gid://shopify/Product/9",
        sku: null,
        title: "Catalogo monete",
        variantGid: null,
      },
    ],
  });

  assert.equal(suggestions[0]?.confidence, "high");
  assert.deepEqual(suggestions[0]?.reasons, [
    "ItemID eBay trovato su barcode",
    "Titolo molto simile",
  ]);
});

test("uses syncbay metafield item id as a strong match signal", () => {
  const suggestions = buildExistingProductMatchSuggestions({
    ebay: { itemId: "156986744184", sku: null, title: "Moneta argento" },
    shopifyProducts: [
      {
        metafields: [
          {
            key: "ebay_item_id",
            namespace: "syncbay",
            value: "156986744184",
          },
        ],
        productGid: "gid://shopify/Product/10",
        title: "Moneta argento",
        variantGid: "gid://shopify/ProductVariant/10",
      },
    ],
  });

  assert.equal(suggestions[0]?.confidence, "high");
  assert.equal(suggestions[0]?.autoLinkable, true);
  assert.deepEqual(suggestions[0]?.reasonCodes, [
    "syncbay_metafield_item_id",
    "title_very_similar",
  ]);
});

test("uses Shopify SKU equal to eBay item id as a strong match signal", () => {
  const suggestions = buildExistingProductMatchSuggestions({
    ebay: {
      itemId: "168172909275",
      sku: "EBAY-168172909275",
      title: "Divisionale 1993 Goldoni",
    },
    shopifyProducts: [
      {
        productGid: "gid://shopify/Product/13",
        sku: "168172909275",
        title: "Scheda storica importata",
        variantGid: "gid://shopify/ProductVariant/13",
      },
    ],
  });

  assert.equal(suggestions[0]?.confidence, "high");
  assert.equal(suggestions[0]?.autoLinkable, true);
  assert.deepEqual(suggestions[0]?.reasonCodes, ["shopify_sku_item_id"]);
});

test("does not mark title-only matches as auto linkable", () => {
  const suggestions = buildExistingProductMatchSuggestions({
    ebay: { itemId: "1", sku: null, title: "Moneta argento Regno Italia" },
    shopifyProducts: [
      {
        productGid: "gid://shopify/Product/11",
        title: "Moneta argento Regno Italia",
        variantGid: "gid://shopify/ProductVariant/11",
      },
    ],
  });

  assert.equal(suggestions[0]?.confidence, "medium");
  assert.equal(suggestions[0]?.autoLinkable, false);
  assert.deepEqual(suggestions[0]?.reasonCodes, ["title_very_similar"]);
});

test("uses item id embedded in handle as a strong conservative signal", () => {
  const suggestions = buildExistingProductMatchSuggestions({
    ebay: { itemId: "987654321", sku: null, title: "Lire argento" },
    shopifyProducts: [
      {
        handle: "lire-argento-987654321",
        productGid: "gid://shopify/Product/12",
        title: "Lire argento",
        variantGid: "gid://shopify/ProductVariant/12",
      },
    ],
  });

  assert.equal(suggestions[0]?.confidence, "high");
  assert.equal(suggestions[0]?.autoLinkable, true);
  assert.ok(suggestions[0]?.reasonCodes.includes("handle_item_id"));
});

test("keeps the strongest variant match for each Shopify product", () => {
  const suggestions = buildExistingProductMatchSuggestions({
    ebay: {
      itemId: "555",
      sku: "MATCH-555",
      title: "Moneta commemorativa",
    },
    shopifyProducts: [
      {
        barcode: null,
        productGid: "gid://shopify/Product/5",
        sku: "OTHER",
        title: "Moneta commemorativa",
        variantGid: "gid://shopify/ProductVariant/51",
      },
      {
        barcode: null,
        productGid: "gid://shopify/Product/5",
        sku: "MATCH-555",
        title: "Moneta commemorativa",
        variantGid: "gid://shopify/ProductVariant/52",
      },
    ],
  });

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0]?.productGid, "gid://shopify/Product/5");
  assert.equal(suggestions[0]?.variantGid, "gid://shopify/ProductVariant/52");
  assert.equal(suggestions[0]?.confidence, "high");
});

test("does not auto link product-level matches when variant candidates are truncated", () => {
  const suggestions = buildExistingProductMatchSuggestions({
    ebay: {
      itemId: "987654",
      sku: "HIDDEN-SKU",
      title: "Moneta con molte varianti",
    },
    shopifyProducts: [
      {
        handle: "moneta-con-molte-varianti-987654",
        productGid: "gid://shopify/Product/9",
        sku: "VISIBLE-SKU",
        title: "Moneta con molte varianti",
        variantGid: "gid://shopify/ProductVariant/91",
        variantsTruncated: true,
      },
    ],
  });

  assert.equal(suggestions[0]?.confidence, "high");
  assert.equal(suggestions[0]?.autoLinkable, false);
  assert.deepEqual(suggestions[0]?.reasonCodes, [
    "handle_item_id",
    "title_very_similar",
  ]);
});

test("formats match suggestion summaries without implying automatic linking", () => {
  assert.equal(
    getMatchSuggestionSummary({
      confidence: "high",
      reasons: ["SKU identico"],
    }),
    "Possibile collegamento: confidenza alta, SKU identico. Conferma manuale richiesta.",
  );
});

import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as productMatching from "./syncbay-product-matching.ts";

const {
  buildExistingProductMatchSuggestions,
  getMatchSuggestionSummary,
} = productMatching;

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

test("formats match suggestion summaries without implying automatic linking", () => {
  assert.equal(
    getMatchSuggestionSummary({ confidence: "high", reasons: ["SKU identico"] }),
    "Possibile collegamento: confidenza alta, SKU identico. Conferma manuale richiesta.",
  );
});

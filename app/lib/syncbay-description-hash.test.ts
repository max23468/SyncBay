import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { getSyncBayDescriptionHash, hashNullableText } from "./syncbay-description-hash.ts";

test("uses Shopify-returned description HTML as SyncBay baseline", () => {
  const inputHtml = "<p>Descrizione eBay</p>";
  const shopifyHtml = "<p>Descrizione eBay</p>\n";

  assert.equal(
    getSyncBayDescriptionHash({
      fallbackDescriptionHtml: inputHtml,
      shopifyDescriptionHtml: shopifyHtml,
    }),
    hashNullableText(shopifyHtml),
  );
});

test("falls back to imported description only when Shopify HTML was not loaded", () => {
  const inputHtml = "<p>Descrizione eBay</p>";

  assert.equal(
    getSyncBayDescriptionHash({
      fallbackDescriptionHtml: inputHtml,
    }),
    hashNullableText(inputHtml),
  );
});

test("preserves null Shopify description as an empty baseline", () => {
  assert.equal(
    getSyncBayDescriptionHash({
      fallbackDescriptionHtml: "<p>Descrizione eBay</p>",
      shopifyDescriptionHtml: null,
    }),
    null,
  );
});

import assert from "node:assert/strict";
import { test } from "vitest";

import {
  getImportedProductSingularLabel,
  getImportedProductsLabel,
  getImportProductStatusLabelCapitalized,
  normalizeImportProductStatus,
} from "./import-product-status.ts";

test("normalizes only DRAFT as a draft import status", () => {
  assert.equal(normalizeImportProductStatus("DRAFT"), "DRAFT");
  assert.equal(normalizeImportProductStatus("ACTIVE"), "ACTIVE");
  assert.equal(normalizeImportProductStatus("unexpected"), "ACTIVE");
  assert.equal(normalizeImportProductStatus(undefined), "ACTIVE");
});

test("renders the capitalized import status labels in Italian", () => {
  assert.equal(getImportProductStatusLabelCapitalized("DRAFT"), "Bozza");
  assert.equal(getImportProductStatusLabelCapitalized("ACTIVE"), "Pubblicato");
});

test("renders the plural imported products labels in Italian", () => {
  assert.equal(getImportedProductsLabel("DRAFT"), "bozze Shopify");
  assert.equal(
    getImportedProductsLabel("ACTIVE"),
    "prodotti Shopify pubblicati",
  );
});

test("renders the singular imported product labels in Italian", () => {
  assert.equal(getImportedProductSingularLabel("DRAFT"), "bozza Shopify");
  assert.equal(
    getImportedProductSingularLabel("ACTIVE"),
    "prodotto Shopify pubblicato",
  );
});

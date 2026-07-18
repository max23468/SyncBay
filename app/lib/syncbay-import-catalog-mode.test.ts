import assert from "node:assert/strict";
import { test } from "vitest";

import * as importCatalogMode from "./syncbay-import-catalog-mode.ts";

const {
  canCreateDraftProductsForCatalogMode,
  getCatalogModeDraftImportBlocker,
  getImportCatalogModeLabel,
  normalizeImportCatalogMode,
} = importCatalogMode;

test("defaults to new product import mode", () => {
  assert.equal(normalizeImportCatalogMode(null), "new_products");
  assert.equal(normalizeImportCatalogMode(""), "new_products");
  assert.equal(normalizeImportCatalogMode("legacy"), "new_products");
});

test("accepts existing catalog takeover mode", () => {
  assert.equal(normalizeImportCatalogMode("existing"), "existing_catalog");
});

test("formats labels in Italian", () => {
  assert.equal(getImportCatalogModeLabel("new_products"), "Nuovi prodotti");
  assert.equal(
    getImportCatalogModeLabel("existing_catalog"),
    "Collega catalogo esistente",
  );
});

test("blocks normal draft import in existing catalog mode", () => {
  assert.equal(canCreateDraftProductsForCatalogMode("new_products"), true);
  assert.equal(canCreateDraftProductsForCatalogMode("existing_catalog"), false);
  assert.equal(getCatalogModeDraftImportBlocker("new_products"), null);
  assert.equal(
    getCatalogModeDraftImportBlocker("existing_catalog"),
    "In modalità catalogo esistente l'import normale è disattivato: usa il dry-run e il takeover dedicato.",
  );
});

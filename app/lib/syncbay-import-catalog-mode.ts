export type ImportCatalogMode = "existing_catalog" | "new_products";

const EXISTING_CATALOG_DRAFT_IMPORT_BLOCKER =
  "In modalità catalogo esistente l'import normale è disattivato: usa il dry-run e il takeover dedicato.";

export function normalizeImportCatalogMode(
  value: FormDataEntryValue | string | null | undefined,
): ImportCatalogMode {
  return value === "existing" || value === "existing_catalog"
    ? "existing_catalog"
    : "new_products";
}

export function getImportCatalogModeParam(mode: ImportCatalogMode) {
  return mode === "existing_catalog" ? "existing" : "new";
}

export function getImportCatalogModeLabel(mode: ImportCatalogMode) {
  return mode === "existing_catalog"
    ? "Collega catalogo esistente"
    : "Nuovi prodotti";
}

export function canCreateDraftProductsForCatalogMode(mode: ImportCatalogMode) {
  return mode === "new_products";
}

export function getCatalogModeDraftImportBlocker(mode: ImportCatalogMode) {
  return canCreateDraftProductsForCatalogMode(mode)
    ? null
    : EXISTING_CATALOG_DRAFT_IMPORT_BLOCKER;
}

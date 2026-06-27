export type ImportCatalogMode = "existing_catalog" | "new_products";

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

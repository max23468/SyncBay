export const IMPORT_PRODUCT_STATUS_VALUES = ["ACTIVE", "DRAFT"] as const;

export type ImportProductStatus = (typeof IMPORT_PRODUCT_STATUS_VALUES)[number];

const DEFAULT_IMPORT_PRODUCT_STATUS: ImportProductStatus = "ACTIVE";

export function normalizeImportProductStatus(
  value: string | null | undefined,
): ImportProductStatus {
  return value === "DRAFT" ? "DRAFT" : DEFAULT_IMPORT_PRODUCT_STATUS;
}

export function getImportProductStatusLabelCapitalized(
  status: ImportProductStatus,
) {
  return status === "DRAFT" ? "Bozza" : "Pubblicato";
}

export function getImportedProductsLabel(status: ImportProductStatus) {
  return status === "DRAFT" ? "bozze Shopify" : "prodotti Shopify pubblicati";
}

export function getImportedProductSingularLabel(status: ImportProductStatus) {
  return status === "DRAFT" ? "bozza Shopify" : "prodotto Shopify pubblicato";
}

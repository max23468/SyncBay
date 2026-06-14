export const SYNCBAY_SHOPIFY_SOURCE_TAG = "Negozio eBay";

export const SYNCBAY_LEGACY_SHOPIFY_IMPORT_TAGS = [
  "SyncBay",
  "Import preview",
  "eBay import pilot",
] as const;

export function buildSyncBayShopifyImportTags() {
  return [SYNCBAY_SHOPIFY_SOURCE_TAG];
}

export function buildShopifyTagSearchQuery(tag: string) {
  return `tag:"${escapeShopifySearchValue(tag)}"`;
}

export function buildSyncBayProductLookupQueries() {
  return [
    SYNCBAY_SHOPIFY_SOURCE_TAG,
    ...SYNCBAY_LEGACY_SHOPIFY_IMPORT_TAGS,
  ].map(buildShopifyTagSearchQuery);
}

function escapeShopifySearchValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

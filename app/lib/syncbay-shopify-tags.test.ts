import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildShopifyTagSearchQuery, buildSyncBayProductLookupQueries, buildSyncBayShopifyImportTags } from "./syncbay-shopify-tags.ts";

test("imports Shopify products with only the generic eBay store tag", () => {
  assert.deepEqual(buildSyncBayShopifyImportTags(), ["Negozio eBay"]);
});

test("keeps lookup compatibility with legacy SyncBay import tags", () => {
  assert.deepEqual(buildSyncBayProductLookupQueries(), [
    'tag:"Negozio eBay"',
    'tag:"SyncBay"',
    'tag:"Import preview"',
    'tag:"eBay import pilot"',
  ]);
});

test("quotes Shopify tag queries with escaped search values", () => {
  assert.equal(
    buildShopifyTagSearchQuery('Negozio "eBay"'),
    'tag:"Negozio \\"eBay\\""',
  );
});

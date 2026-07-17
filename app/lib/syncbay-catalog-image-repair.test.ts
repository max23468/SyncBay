import assert from "node:assert/strict";
import test from "node:test";

import * as catalogImageRepair from "./syncbay-catalog-image-repair.ts";

const {
  getCatalogImageRepairCandidateWhere,
  getCatalogImageRepairItemIds,
  getCatalogImageRepairRunKey,
} = catalogImageRepair;

test("selects only active mapped products without thumbnails for catalog image repair", () => {
  assert.deepEqual(
    getCatalogImageRepairItemIds({
      limit: 10,
      mappings: [
        {
          ebayItemId: "1",
          hasThumbnailUrl: false,
          hasOpenConflicts: false,
          shopifyProductGid: "gid://shopify/Product/1",
        },
        {
          ebayItemId: "2",
          hasThumbnailUrl: false,
          hasOpenConflicts: true,
          shopifyProductGid: "gid://shopify/Product/2",
        },
        {
          ebayItemId: "3",
          hasThumbnailUrl: true,
          hasOpenConflicts: false,
          shopifyProductGid: "gid://shopify/Product/3",
        },
        {
          ebayItemId: "4",
          hasThumbnailUrl: false,
          hasOpenConflicts: false,
          shopifyProductGid: null,
        },
      ],
    }),
    ["1"],
  );
});

test("deduplicates and limits catalog image repair candidates", () => {
  assert.deepEqual(
    getCatalogImageRepairItemIds({
      limit: 2,
      mappings: [
        {
          ebayItemId: "1",
          hasThumbnailUrl: false,
          hasOpenConflicts: false,
          shopifyProductGid: "gid://shopify/Product/1",
        },
        {
          ebayItemId: "1",
          hasThumbnailUrl: false,
          hasOpenConflicts: false,
          shopifyProductGid: "gid://shopify/Product/1",
        },
        {
          ebayItemId: "2",
          hasThumbnailUrl: false,
          hasOpenConflicts: false,
          shopifyProductGid: "gid://shopify/Product/2",
        },
        {
          ebayItemId: "3",
          hasThumbnailUrl: false,
          hasOpenConflicts: false,
          shopifyProductGid: "gid://shopify/Product/3",
        },
      ],
    }),
    ["1", "2"],
  );
});

test("excludes open-conflict mappings before capping catalog image repair candidates", () => {
  assert.deepEqual(
    getCatalogImageRepairCandidateWhere({
      activeStatus: "ACTIVE",
      marketplaceId: "EBAY_IT",
      openConflictStatus: "OPEN",
      shopId: "shop-1",
    }),
    {
      conflicts: { none: { status: "OPEN" } },
      marketplaceId: "EBAY_IT",
      shopId: "shop-1",
      shopifyProductGid: { not: null },
      status: "ACTIVE",
      thumbnailUrl: null,
    },
  );
});

test("uses a UTC daily run key for idempotent image repair enqueueing", () => {
  assert.equal(
    getCatalogImageRepairRunKey(new Date("2026-06-11T23:30:00.000Z")),
    "2026-06-11",
  );
});

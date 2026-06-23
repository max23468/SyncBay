import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { getCatalogImageRepairItemIds, getCatalogImageRepairRunKey } from "./syncbay-catalog-image-repair.ts";

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

test("uses a UTC daily run key for idempotent image repair enqueueing", () => {
  assert.equal(
    getCatalogImageRepairRunKey(new Date("2026-06-11T23:30:00.000Z")),
    "2026-06-11",
  );
});

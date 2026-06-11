import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as conflictDetection from "./syncbay-conflict-detection.ts";

const {
  getAlignedOpenConflictFields,
  getLatestSyncBayDescriptionBaselineWhere,
  shouldBlockIncrementalSyncForOpenConflictMappingStatus,
  shouldDetectShopifyConflictsForMappingStatus,
  shouldResolveOpenConflictsForInactiveMappingStatus,
  shouldSkipImagesConflictWhenEbayHasNoImages,
  shouldSkipQuantityConflictForArchivedProduct,
} = conflictDetection;

test("builds a description baseline query that skips null description hashes", () => {
  const where = getLatestSyncBayDescriptionBaselineWhere("mapping-1");

  assert.deepEqual(where.descriptionHash, { not: null });
  assert.equal(where.mappingId, "mapping-1");
  assert.equal(where.source, "SYNCBAY");
});

test("finds open conflict fields that are aligned again", () => {
  assert.deepEqual(
    getAlignedOpenConflictFields({
      detectedConflictFields: ["quantity"],
      openConflictFields: ["description", "quantity", "images"],
    }),
    ["description", "images"],
  );
});

test("does not auto-close unknown conflict fields", () => {
  assert.deepEqual(
    getAlignedOpenConflictFields({
      detectedConflictFields: [],
      openConflictFields: ["customField"],
    }),
    [],
  );
});

test("skips archived zero-quantity noise when both products are archived", () => {
  assert.equal(
    shouldSkipQuantityConflictForArchivedProduct({
      shopifyProductStatus: "ARCHIVED",
      syncBayProductStatus: "ARCHIVED",
      syncBayQuantity: 0,
    }),
    true,
  );
});

test("keeps quantity conflicts active for sellable or mismatched products", () => {
  assert.equal(
    shouldSkipQuantityConflictForArchivedProduct({
      shopifyProductStatus: "ACTIVE",
      syncBayProductStatus: "ARCHIVED",
      syncBayQuantity: 0,
    }),
    false,
  );
  assert.equal(
    shouldSkipQuantityConflictForArchivedProduct({
      shopifyProductStatus: "ARCHIVED",
      syncBayProductStatus: "ARCHIVED",
      syncBayQuantity: 1,
    }),
    false,
  );
});

test("detects Shopify conflicts only for active mappings", () => {
  assert.equal(shouldDetectShopifyConflictsForMappingStatus("ACTIVE"), true);
  assert.equal(shouldDetectShopifyConflictsForMappingStatus("OUT_OF_STOCK"), false);
  assert.equal(shouldDetectShopifyConflictsForMappingStatus("ARCHIVED"), false);
  assert.equal(shouldDetectShopifyConflictsForMappingStatus("PAUSED"), false);
  assert.equal(shouldDetectShopifyConflictsForMappingStatus("ERROR"), false);
  assert.equal(shouldDetectShopifyConflictsForMappingStatus(null), false);
});

test("blocks incremental sync on open conflicts for sellable or held mappings", () => {
  assert.equal(
    shouldBlockIncrementalSyncForOpenConflictMappingStatus("ACTIVE"),
    true,
  );
  assert.equal(
    shouldBlockIncrementalSyncForOpenConflictMappingStatus("OUT_OF_STOCK"),
    false,
  );
  assert.equal(
    shouldBlockIncrementalSyncForOpenConflictMappingStatus("ARCHIVED"),
    false,
  );
  assert.equal(
    shouldBlockIncrementalSyncForOpenConflictMappingStatus("PAUSED"),
    true,
  );
  assert.equal(
    shouldBlockIncrementalSyncForOpenConflictMappingStatus("ERROR"),
    true,
  );
  assert.equal(
    shouldBlockIncrementalSyncForOpenConflictMappingStatus(null),
    false,
  );
});

test("resolves open conflicts automatically only for inactive-source mappings", () => {
  assert.equal(
    shouldResolveOpenConflictsForInactiveMappingStatus("OUT_OF_STOCK"),
    true,
  );
  assert.equal(
    shouldResolveOpenConflictsForInactiveMappingStatus("ARCHIVED"),
    true,
  );
  assert.equal(shouldResolveOpenConflictsForInactiveMappingStatus("ACTIVE"), false);
  assert.equal(shouldResolveOpenConflictsForInactiveMappingStatus("PAUSED"), false);
  assert.equal(shouldResolveOpenConflictsForInactiveMappingStatus("ERROR"), false);
  assert.equal(shouldResolveOpenConflictsForInactiveMappingStatus(null), false);
});

test("skips images conflicts when eBay has no media but Shopify does", () => {
  assert.equal(
    shouldSkipImagesConflictWhenEbayHasNoImages({
      syncBayImageCount: 0,
      shopifyImageCount: 2,
    }),
    true,
  );
});

test("keeps images conflicts when eBay has media or both sides are empty", () => {
  assert.equal(
    shouldSkipImagesConflictWhenEbayHasNoImages({
      syncBayImageCount: 3,
      shopifyImageCount: 2,
    }),
    false,
  );
  assert.equal(
    shouldSkipImagesConflictWhenEbayHasNoImages({
      syncBayImageCount: 0,
      shopifyImageCount: 0,
    }),
    false,
  );
  assert.equal(
    shouldSkipImagesConflictWhenEbayHasNoImages({
      syncBayImageCount: null,
      shopifyImageCount: 2,
    }),
    false,
  );
});

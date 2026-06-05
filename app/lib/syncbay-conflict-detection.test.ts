import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { getAlignedOpenConflictFields, getLatestSyncBayDescriptionBaselineWhere, shouldSkipQuantityConflictForArchivedProduct } from "./syncbay-conflict-detection.ts";

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

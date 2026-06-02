import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildCatalogReconcilePlan, isCatalogReconcileScanComplete } from "./syncbay-catalog-reconcile.ts";

test("plans active eBay item ids in stable batches", () => {
  assert.deepEqual(
    buildCatalogReconcilePlan({
      activeEbayItemIds: ["3", "1", "2"],
      activeScanComplete: true,
      batchSize: 2,
      mappedEbayItemIds: ["1"],
    }),
    {
      inactiveEbayItemIds: [],
      syncBatches: [
        ["3", "1"],
        ["2"],
      ],
    },
  );
});

test("deduplicates active item ids before batching", () => {
  assert.deepEqual(
    buildCatalogReconcilePlan({
      activeEbayItemIds: ["1", "1", "2"],
      activeScanComplete: true,
      batchSize: 50,
      mappedEbayItemIds: ["1", "3"],
    }),
    {
      inactiveEbayItemIds: ["3"],
      syncBatches: [["1", "2"]],
    },
  );
});

test("does not archive mappings when the active scan is empty", () => {
  assert.deepEqual(
    buildCatalogReconcilePlan({
      activeEbayItemIds: [],
      activeScanComplete: true,
      batchSize: 50,
      mappedEbayItemIds: ["1", "2"],
    }),
    {
      inactiveEbayItemIds: [],
      syncBatches: [],
    },
  );
});

test("does not archive mappings when the active scan is incomplete", () => {
  assert.deepEqual(
    buildCatalogReconcilePlan({
      activeEbayItemIds: ["1"],
      activeScanComplete: false,
      batchSize: 50,
      mappedEbayItemIds: ["1", "2"],
    }),
    {
      inactiveEbayItemIds: [],
      syncBatches: [["1"]],
    },
  );
});

test("rejects invalid batch sizes", () => {
  assert.throws(
    () =>
      buildCatalogReconcilePlan({
        activeEbayItemIds: ["1"],
        activeScanComplete: true,
        batchSize: 0,
        mappedEbayItemIds: [],
      }),
    /batchSize/,
  );
});

test("marks an eBay active scan complete only when it covers the available catalog", () => {
  assert.equal(
    isCatalogReconcileScanComplete({
      itemIds: ["1", "2"],
      maxProducts: 2000,
      readCount: 2,
      totalAvailable: 2,
    }),
    true,
  );
  assert.equal(
    isCatalogReconcileScanComplete({
      itemIds: ["1"],
      maxProducts: 2000,
      readCount: 1,
      totalAvailable: 2,
    }),
    false,
  );
  assert.equal(
    isCatalogReconcileScanComplete({
      itemIds: ["1"],
      maxProducts: 1,
      readCount: 1,
      totalAvailable: 2,
    }),
    false,
  );
});

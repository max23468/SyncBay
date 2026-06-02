import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildEbayItemJobSplitIdempotencyKey, buildEbayItemJobSplitPayloads, isSchedulableSyncJob, isStaleInternalShopifyImportJob } from "./syncbay-job-scheduling.ts";

test("keeps internal Shopify import jobs out of the runnable queue", () => {
  assert.equal(
    isSchedulableSyncJob({
      idempotencyKey: "draft-import:shop-1:abc",
      payload: { ebayItemIds: ["1"], source: "trading_api" },
    }),
    false,
  );
  assert.equal(
    isSchedulableSyncJob({
      idempotencyKey: null,
      payload: { ebayItemIds: ["1"], source: "shopify_import" },
    }),
    false,
  );
  assert.equal(
    isSchedulableSyncJob({
      idempotencyKey: "catalog-import-batch:shop-1:abc",
      payload: { ebayItemIds: ["1"], source: "trading_api" },
    }),
    true,
  );
  assert.equal(
    isSchedulableSyncJob({
      idempotencyKey: null,
      payload: { ebayItemIds: ["1"], source: "catalog_reconcile" },
    }),
    true,
  );
});

test("splits oversized eBay item jobs without dropping payload metadata", () => {
  const chunks = buildEbayItemJobSplitPayloads({
    ebayItemIds: ["1", "2", "3", "4", "5"],
    maxItems: 2,
    parentJobId: "job-parent",
    payload: {
      batchIndex: 4,
      ebayItemIds: ["1", "2", "3", "4", "5"],
      importProductStatus: "ACTIVE",
      marketplaceId: "EBAY_IT",
      source: "catalog_reconcile",
    },
  });

  assert.deepEqual(chunks, [
    {
      batchIndex: 4,
      ebayItemIds: ["1", "2"],
      importProductStatus: "ACTIVE",
      marketplaceId: "EBAY_IT",
      parentJobId: "job-parent",
      requestedCount: 2,
      source: "catalog_reconcile",
      splitCount: 3,
      splitIndex: 1,
    },
    {
      batchIndex: 4,
      ebayItemIds: ["3", "4"],
      importProductStatus: "ACTIVE",
      marketplaceId: "EBAY_IT",
      parentJobId: "job-parent",
      requestedCount: 2,
      source: "catalog_reconcile",
      splitCount: 3,
      splitIndex: 2,
    },
    {
      batchIndex: 4,
      ebayItemIds: ["5"],
      importProductStatus: "ACTIVE",
      marketplaceId: "EBAY_IT",
      parentJobId: "job-parent",
      requestedCount: 1,
      source: "catalog_reconcile",
      splitCount: 3,
      splitIndex: 3,
    },
  ]);
});

test("detects stale internal Shopify import traces", () => {
  const now = new Date("2026-06-03T00:20:00.000Z");
  const staleAfterMs = 15 * 60 * 1000;

  assert.equal(
    isStaleInternalShopifyImportJob({
      idempotencyKey: "draft-import:shop-1:abc",
      now,
      staleAfterMs,
      startedAt: new Date("2026-06-03T00:04:59.000Z"),
      status: "RUNNING",
    }),
    true,
  );
  assert.equal(
    isStaleInternalShopifyImportJob({
      idempotencyKey: "draft-import:shop-1:abc",
      now,
      staleAfterMs,
      startedAt: new Date("2026-06-03T00:10:00.000Z"),
      status: "RUNNING",
    }),
    false,
  );
  assert.equal(
    isStaleInternalShopifyImportJob({
      idempotencyKey: "catalog-import-batch:shop-1:abc",
      now,
      staleAfterMs,
      startedAt: new Date("2026-06-03T00:04:59.000Z"),
      status: "RUNNING",
    }),
    false,
  );
});

test("includes run identity in split job idempotency keys", () => {
  const firstRunKey = buildEbayItemJobSplitIdempotencyKey({
    parentJobId: "parent-1",
    payload: {
      catalogImportRunId: "catalog-import:shop-1:2026-06-03T00:00:00.000Z",
      ebayItemIds: ["1", "2"],
    },
    splitIndex: 1,
  });
  const secondRunKey = buildEbayItemJobSplitIdempotencyKey({
    parentJobId: "parent-1",
    payload: {
      catalogImportRunId: "catalog-import:shop-1:2026-06-03T00:05:00.000Z",
      ebayItemIds: ["1", "2"],
    },
    splitIndex: 1,
  });

  assert.notEqual(firstRunKey, secondRunKey);
  assert.equal(
    firstRunKey,
    buildEbayItemJobSplitIdempotencyKey({
      parentJobId: "parent-1",
      payload: {
        catalogImportRunId: "catalog-import:shop-1:2026-06-03T00:00:00.000Z",
        ebayItemIds: ["1", "2"],
      },
      splitIndex: 1,
    }),
  );
});

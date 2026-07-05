import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildEbayItemJobSplitIdempotencyKey, buildEbayItemJobSplitPayloads, buildSellerEventsNoopMarker, getDuplicateShopifyChangeJobIdsToCancel, getShopifyChangeJobResourceKeys, isFacetOnlyIncrementalJobPayload, isSchedulableSyncJob, isStaleInternalShopifyImportJob, normalizeRunDueLimit, prioritizeIncrementalJobsByFacetMode, shouldCancelSyncJobAfterShopUninstall, shouldSkipRecentShopifyProductChangeJob } from "./syncbay-job-scheduling.ts";

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

test("cancels only active sync jobs after a shop uninstall", () => {
  assert.equal(shouldCancelSyncJobAfterShopUninstall("PENDING"), true);
  assert.equal(shouldCancelSyncJobAfterShopUninstall("RETRYING"), true);
  assert.equal(shouldCancelSyncJobAfterShopUninstall("RUNNING"), true);

  assert.equal(shouldCancelSyncJobAfterShopUninstall("SUCCEEDED"), false);
  assert.equal(shouldCancelSyncJobAfterShopUninstall("FAILED"), false);
  assert.equal(shouldCancelSyncJobAfterShopUninstall("CANCELLED"), false);
  assert.equal(shouldCancelSyncJobAfterShopUninstall(null), false);
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
      startedAt: new Date("2026-06-03T00:04:59.000Z"),
      status: "RETRYING",
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

test("normalizes run-due job limits for cron drain batches", () => {
  assert.equal(normalizeRunDueLimit(), 5);
  assert.equal(normalizeRunDueLimit(Number.NaN), 5);
  assert.equal(normalizeRunDueLimit(0), 1);
  assert.equal(normalizeRunDueLimit(12), 12);
  assert.equal(normalizeRunDueLimit(999), 20);
});

test("treats missing facetOnly as a regular incremental payload", () => {
  assert.equal(
    isFacetOnlyIncrementalJobPayload({ source: "seller_events_delta" }),
    false,
  );
  assert.equal(
    isFacetOnlyIncrementalJobPayload({
      facetOnly: true,
      source: "facet_backfill",
    }),
    true,
  );
});

test("prioritizes regular incremental jobs before facet-only jobs", () => {
  assert.deepEqual(
    prioritizeIncrementalJobsByFacetMode([
      { id: "facet", payload: { facetOnly: true, source: "facet_backfill" } },
      { id: "regular", payload: { source: "seller_events_delta" } },
    ]).map((job) => job.id),
    ["regular", "facet"],
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

test("builds seller-events watermark marker even when image repair jobs are queued", () => {
  assert.deepEqual(
    buildSellerEventsNoopMarker({
      eventReadCount: 0,
      imageRepairJobCount: 12,
      marketplaceId: "EBAY_IT",
      modTimeFrom: "2026-07-04T13:13:00.000Z",
      modTimeTo: "2026-07-04T13:23:00.000Z",
    }),
    {
      payload: {
        eventReadCount: 0,
        imageRepairJobCount: 12,
        marketplaceId: "EBAY_IT",
        modTimeFrom: "2026-07-04T13:13:00.000Z",
        modTimeTo: "2026-07-04T13:23:00.000Z",
        source: "seller_events_delta",
        watermarkAdvanced: true,
      },
      result: {
        eventReadCount: 0,
        imageRepairJobCount: 12,
        noWork: true,
        source: "seller_events_delta",
        watermarkAdvanced: true,
      },
    },
  );
});

test("keeps the newest Shopify change job per shop topic and resource", () => {
  assert.deepEqual(
    getDuplicateShopifyChangeJobIdsToCancel([
      {
        createdAt: new Date("2026-06-19T10:00:00.000Z"),
        id: "older-product",
        payload: {
          resourceId: "gid://shopify/Product/1",
          topic: "products/update",
        },
        shopId: "shop-1",
      },
      {
        createdAt: new Date("2026-06-19T10:00:01.000Z"),
        id: "newer-product",
        payload: {
          resourceId: "gid://shopify/Product/1",
          topic: "products/update",
        },
        shopId: "shop-1",
      },
      {
        createdAt: new Date("2026-06-19T10:00:02.000Z"),
        id: "other-topic",
        payload: {
          inventoryItemGid: "gid://shopify/InventoryItem/1",
          topic: "inventory_levels/update",
        },
        shopId: "shop-1",
      },
      {
        createdAt: new Date("2026-06-19T10:00:03.000Z"),
        id: "missing-resource-kept",
        payload: { topic: "products/update" },
        shopId: "shop-1",
      },
      {
        createdAt: new Date("2026-06-19T10:00:04.000Z"),
        id: "other-shop-kept",
        payload: {
          resourceId: "gid://shopify/Product/1",
          topic: "products/update",
        },
        shopId: "shop-2",
      },
    ]),
    ["older-product"],
  );
});

test("coalesces Shopify change jobs that only carry normalized admin graphql ids", () => {
  assert.deepEqual(
    getDuplicateShopifyChangeJobIdsToCancel([
      {
        createdAt: new Date("2026-06-20T10:00:00.000Z"),
        id: "older-product-admin-id",
        payload: {
          adminGraphqlApiId: "gid://shopify/Product/1",
          topic: "products/update",
        },
        shopId: "shop-1",
      },
      {
        createdAt: new Date("2026-06-20T10:00:01.000Z"),
        id: "newer-product-admin-id",
        payload: {
          admin_graphql_api_id: "gid://shopify/Product/1",
          topic: "products/update",
        },
        shopId: "shop-1",
      },
    ]),
    ["older-product-admin-id"],
  );
});

test("keeps every usable Shopify change resource key for runtime matching", () => {
  assert.deepEqual(
    getShopifyChangeJobResourceKeys({
      adminGraphqlApiId: "gid://shopify/Product/1",
      admin_graphql_api_id: "gid://shopify/Product/1",
      inventoryItemGid: "gid://shopify/InventoryItem/1",
      resourceId: "gid://shopify/InventoryLevel/1",
    }),
    [
      "gid://shopify/InventoryLevel/1",
      "gid://shopify/InventoryItem/1",
      "gid://shopify/Product/1",
    ],
  );
});

test("does not skip product update webhooks behind a running change job", () => {
  assert.equal(
    shouldSkipRecentShopifyProductChangeJob({
      now: new Date("2026-06-23T08:01:30.000Z"),
      payload: {
        resourceId: "gid://shopify/Product/1",
        topic: "products/update",
      },
      recentJob: {
        payload: {
          adminGraphqlApiId: "gid://shopify/Product/1",
          topic: "products/update",
        },
        startedAt: new Date("2026-06-23T08:00:30.000Z"),
        status: "RUNNING",
      },
    }),
    false,
  );
});

test("does not skip old, completed, failed, or non-product Shopify change webhooks", () => {
  const now = new Date("2026-06-23T08:05:00.000Z");

  assert.equal(
    shouldSkipRecentShopifyProductChangeJob({
      now,
      payload: {
        resourceId: "gid://shopify/Product/1",
        topic: "products/update",
      },
      recentJob: {
        finishedAt: new Date("2026-06-23T08:00:00.000Z"),
        payload: {
          resourceId: "gid://shopify/Product/1",
          topic: "products/update",
        },
        status: "SUCCEEDED",
      },
    }),
    false,
  );
  assert.equal(
    shouldSkipRecentShopifyProductChangeJob({
      now,
      payload: {
        resourceId: "gid://shopify/Product/1",
        topic: "products/update",
      },
      recentJob: {
        finishedAt: new Date("2026-06-23T08:04:30.000Z"),
        payload: {
          resourceId: "gid://shopify/Product/1",
          topic: "products/update",
        },
        status: "SUCCEEDED",
      },
    }),
    false,
  );
  assert.equal(
    shouldSkipRecentShopifyProductChangeJob({
      now,
      payload: {
        resourceId: "gid://shopify/Product/1",
        topic: "products/update",
      },
      recentJob: {
        finishedAt: new Date("2026-06-23T08:04:30.000Z"),
        payload: {
          resourceId: "gid://shopify/Product/1",
          topic: "products/update",
        },
        status: "FAILED",
      },
    }),
    false,
  );
  assert.equal(
    shouldSkipRecentShopifyProductChangeJob({
      now,
      payload: {
        inventoryItemGid: "gid://shopify/InventoryItem/1",
        topic: "inventory_levels/update",
      },
      recentJob: {
        finishedAt: new Date("2026-06-23T08:04:30.000Z"),
        payload: {
          inventoryItemGid: "gid://shopify/InventoryItem/1",
          topic: "inventory_levels/update",
        },
        status: "SUCCEEDED",
      },
    }),
    false,
  );
});

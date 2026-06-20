import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { classifyMappingDrift } from "./syncbay-mapping-drift.ts";

const baseInput = {
  activeEbayItemIds: ["1001", "1002"],
  activeScanComplete: true,
  existingShopifyProductGids: ["gid://shopify/Product/1"],
  shopifyScanComplete: true,
};

test("flags a mapping whose Shopify product disappeared", () => {
  const report = classifyMappingDrift({
    ...baseInput,
    mappings: [
      {
        ebayItemId: "1001",
        shopifyProductGid: "gid://shopify/Product/999",
        status: "ACTIVE",
      },
    ],
  });

  assert.equal(report.items.length, 1);
  assert.equal(report.items[0].reason, "orphan_shopify_missing");
  assert.equal(report.summary.orphan_shopify_missing, 1);
});

test("flags a delisted eBay listing not yet marked out of stock", () => {
  const report = classifyMappingDrift({
    ...baseInput,
    mappings: [
      {
        ebayItemId: "9999",
        shopifyProductGid: "gid://shopify/Product/1",
        status: "ACTIVE",
      },
    ],
  });

  assert.equal(report.items[0].reason, "delisted_not_marked");
});

test("does not flag listings already moved to out of stock (ADR 0011)", () => {
  const report = classifyMappingDrift({
    ...baseInput,
    mappings: [
      {
        ebayItemId: "9999",
        shopifyProductGid: "gid://shopify/Product/1",
        status: "OUT_OF_STOCK",
      },
    ],
  });

  assert.equal(report.items.length, 0);
});

test("flags errored mappings", () => {
  const report = classifyMappingDrift({
    ...baseInput,
    mappings: [
      {
        ebayItemId: "1001",
        shopifyProductGid: "gid://shopify/Product/1",
        status: "ERROR",
      },
    ],
  });

  assert.equal(report.items[0].reason, "errored");
});

test("stays silent on healthy mappings", () => {
  const report = classifyMappingDrift({
    ...baseInput,
    mappings: [
      {
        ebayItemId: "1001",
        shopifyProductGid: "gid://shopify/Product/1",
        status: "ACTIVE",
      },
    ],
  });

  assert.deepEqual(report.items, []);
  assert.equal(report.summary.total, 0);
});

test("does not flag delisting before the eBay scan is complete", () => {
  const report = classifyMappingDrift({
    ...baseInput,
    activeScanComplete: false,
    mappings: [
      {
        ebayItemId: "9999",
        shopifyProductGid: "gid://shopify/Product/1",
        status: "ACTIVE",
      },
    ],
  });

  assert.deepEqual(report.items, []);
});

test("does not flag orphans before the Shopify scan is complete", () => {
  const report = classifyMappingDrift({
    ...baseInput,
    shopifyScanComplete: false,
    mappings: [
      {
        ebayItemId: "1001",
        shopifyProductGid: "gid://shopify/Product/999",
        status: "ACTIVE",
      },
    ],
  });

  assert.deepEqual(report.items, []);
});

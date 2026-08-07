import assert from "node:assert/strict";
import { SyncJobStatus, SyncJobType } from "@prisma/client";
import { test, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  markSucceeded: vi.fn(async () => {}),
  productMapping: vi.fn(async () => null),
  productMappings: vi.fn(async () => []),
  snapshots: vi.fn(async () => []),
}));

vi.mock("../db.server", () => ({
  default: {
    productMapping: {
      findFirst: fakes.productMapping,
      findMany: fakes.productMappings,
    },
    productSnapshot: { findMany: fakes.snapshots },
  },
}));
vi.mock("./shopify-admin-session.server", () => ({
  getShopifyAdminGraphqlClient: async () => ({ graphql: async () => Response.json({}) }),
}));
vi.mock("./pricing-rules.server", () => ({
  getPricingRuleForShopId: async () => ({ discountPercent: 0, roundingMode: "CENTS" }),
}));
vi.mock("./sync-job-shared.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sync-job-shared.server")>()),
  getConnectedEbayConnection: async () => ({ id: "connection-1" }),
  getImportPreviewResultByItemIds: async () => ({ items: [] }),
  getInterruptedRunningSyncJobResult: async () => null,
  getLatestFacetBaselinesByItemId: async () => ({}),
  markJobSucceeded: fakes.markSucceeded,
}));

import {
  runFacetOnlyIncrementalSyncJob,
  runPricingOnlyIncrementalSyncJob,
} from "./sync-job-incremental.server";
import type { DueSyncJob } from "./sync-job-shared.server";
import { runUpdateEbayStockJob } from "./sync-job-stock.server";

test("pricing e facet chiudono correttamente batch incrementali vuoti", async () => {
  const job = makeJob(SyncJobType.SYNC_INCREMENTAL, {});
  const base = {
    alignedDescriptionConflictResolvedCount: 0,
    alignedPriceConflictResolvedCount: 0,
    job,
    openConflictSkippedCount: 0,
    reactivationConflictResolvedCount: 0,
    requestedItemIds: [],
    syncableItemIds: [],
  };

  assert.equal((await runPricingOnlyIncrementalSyncJob(base)).status, "succeeded");
  assert.equal((await runFacetOnlyIncrementalSyncJob(base)).status, "succeeded");
  const calls = fakes.markSucceeded.mock.calls as unknown as Array<
    [{ result: Record<string, unknown> }]
  >;
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.[0].result.pricingOnly, true);
  assert.equal(calls[1]?.[0].result.facetOnly, true);
});

test("stock registra come saltata una riga ordine senza mapping", async () => {
  const job = makeJob(SyncJobType.UPDATE_EBAY_STOCK, {
    lineItems: [
      {
        lineItemKey: "line-1",
        quantity: 1,
        shopifyProductGid: "gid://shopify/Product/1",
        shopifyVariantGid: "gid://shopify/ProductVariant/1",
      },
    ],
  });

  assert.equal((await runUpdateEbayStockJob(job)).status, "succeeded");
  const result = (
    fakes.markSucceeded.mock.calls as unknown as Array<
      [{ result: { skipped: Array<{ reason: string }>; skippedCount: number } }]
    >
  ).at(-1)?.[0].result;
  assert.ok(result);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.skipped[0].reason, "mapping_not_found");
});

function makeJob(type: SyncJobType, payload: Record<string, unknown>) {
  return {
    attempts: 0,
    id: `job-${type}`,
    payload,
    shop: {
      defaultLocationGid: "gid://shopify/Location/1",
      shopDomain: "synthetic.myshopify.com",
    },
    shopId: "shop-1",
    status: SyncJobStatus.RUNNING,
    type,
  } as DueSyncJob;
}

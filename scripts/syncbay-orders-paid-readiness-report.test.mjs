import assert from "node:assert/strict";
import test from "node:test";

import { buildReadinessReport } from "./syncbay-orders-paid-readiness-report.mjs";

const basePayload = {
  candidates: [],
  checkedAt: "2026-06-03T12:00:00.000Z",
  ebayConnection: {
    marketplaceId: "EBAY_IT",
    status: "CONNECTED",
  },
  latestStockJobs: [],
  mappingCounts: {
    activeMappings: 1,
    activeWithEurSnapshot: 1,
    activeWithLatestSnapshot: 1,
    activeWithVariant: 1,
    eligibleQuantityPositive: 1,
  },
  queue: {
    activeJobs: 0,
    activeStockJobs: 0,
    activeSyncJobs: 0,
  },
  session: {
    accessTokenLength: 10,
    expires: "2026-06-03T13:00:00.000Z",
    id: "offline_syncbay-dev.myshopify.com",
    isOnline: false,
    refreshTokenExpires: "2026-07-03T12:00:00.000Z",
    refreshTokenLength: 10,
    scope: "read_orders write_orders",
  },
  shop: {
    id: "shop-1",
    shopDomain: "syncbay-dev.myshopify.com",
  },
};

test("blocks orders/paid readiness when the eBay connection is not connected", () => {
  const report = buildReadinessReport(
    {
      ...basePayload,
      ebayConnection: {
        marketplaceId: "EBAY_IT",
        status: "RECONNECT_REQUIRED",
      },
    },
    { shopDomain: "syncbay-dev.myshopify.com" },
  );

  assert.equal(report.webhookRuntimeReady, false);
  assert.match(report.webhookRuntimeBlockers.join("\n"), /eBay/);
  assert.match(report.webhookRuntimeBlockers.join("\n"), /RECONNECT_REQUIRED/);
  assert.equal(report.adminOrderCreateTestReady, false);
});

test("keeps orders/paid readiness green when Shopify, eBay, queue and mappings are ready", () => {
  const report = buildReadinessReport(basePayload, {
    shopDomain: "syncbay-dev.myshopify.com",
  });

  assert.equal(report.webhookRuntimeReady, true);
  assert.deepEqual(report.webhookRuntimeBlockers, []);
  assert.equal(report.adminOrderCreateTestReady, true);
});

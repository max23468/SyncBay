import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildPricingRuleSyncPlan, isPricingOnlySyncJobPayload } from "./syncbay-pricing-rule-sync.ts";

test("queues pricing rule sync in deterministic batches when eBay and Shopify location are ready", () => {
  const plan = buildPricingRuleSyncPlan({
    activeEbayItemIds: ["1003", "1001", "1002"],
    batchSize: 2,
    ebayConnected: true,
    hasDefaultLocation: true,
  });

  assert.deepEqual(plan, {
    batches: [["1003", "1001"], ["1002"]],
    pricingOnly: true,
    queuedProductCount: 3,
    skippedReason: null,
  });
});

test("skips pricing rule sync with an operational reason when prerequisites are missing", () => {
  assert.deepEqual(
    buildPricingRuleSyncPlan({
      activeEbayItemIds: [],
      batchSize: 10,
      ebayConnected: true,
      hasDefaultLocation: true,
    }),
    {
      batches: [],
      pricingOnly: true,
      queuedProductCount: 0,
      skippedReason: "nessun prodotto attivo",
    },
  );
  assert.equal(
    buildPricingRuleSyncPlan({
      activeEbayItemIds: ["1001"],
      batchSize: 10,
      ebayConnected: false,
      hasDefaultLocation: true,
    }).skippedReason,
    "account eBay non collegato",
  );
  assert.equal(
    buildPricingRuleSyncPlan({
      activeEbayItemIds: ["1001"],
      batchSize: 10,
      ebayConnected: true,
      hasDefaultLocation: false,
    }).skippedReason,
    "location Shopify predefinita assente",
  );
});

test("treats legacy pricing-rule update jobs as pricing-only", () => {
  assert.equal(
    isPricingOnlySyncJobPayload({ source: "pricing_rule_update" }),
    true,
  );
  assert.equal(isPricingOnlySyncJobPayload({ pricingOnly: true }), true);
  assert.equal(
    isPricingOnlySyncJobPayload({ source: "seller_events_delta" }),
    false,
  );
});

import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { getExpectedMarketplaceCurrency, isEbayStockDryRunEnabled, selectEbayTradingInventorySku, selectShopifyOrderCurrency, validateEbayStockCurrency, validateEbayStockOrderCurrency } from "./syncbay-stock-guard.ts";

test("maps EBAY_IT to EUR", () => {
  assert.equal(getExpectedMarketplaceCurrency("EBAY_IT"), "EUR");
});

test("enables stock dry-run only for explicit true", () => {
  assert.equal(isEbayStockDryRunEnabled("true"), true);
  assert.equal(isEbayStockDryRunEnabled("TRUE"), true);
  assert.equal(isEbayStockDryRunEnabled("false"), false);
  assert.equal(isEbayStockDryRunEnabled(undefined), false);
});

test("omits SyncBay fallback SKU from eBay Trading stock updates", () => {
  assert.equal(
    selectEbayTradingInventorySku({
      itemId: "168148953253",
      sku: "EBAY-168148953253",
    }),
    null,
  );
  assert.equal(
    selectEbayTradingInventorySku({
      itemId: "168148953253",
      sku: " ebay-168148953253 ",
    }),
    null,
  );
  assert.equal(
    selectEbayTradingInventorySku({
      itemId: "168148953253",
      sku: "SELLER-SKU-1",
    }),
    "SELLER-SKU-1",
  );
});

test("blocks EBAY_IT stock updates when snapshot currency is missing or not EUR", () => {
  assert.deepEqual(
    validateEbayStockCurrency({
      marketplaceId: "EBAY_IT",
      snapshotCurrency: null,
    }),
    {
      expectedCurrency: "EUR",
      ok: false,
      reason: "missing_snapshot_currency",
      snapshotCurrency: null,
    },
  );

  assert.deepEqual(
    validateEbayStockCurrency({
      marketplaceId: "EBAY_IT",
      snapshotCurrency: "USD",
    }),
    {
      expectedCurrency: "EUR",
      ok: false,
      reason: "currency_mismatch",
      snapshotCurrency: "USD",
    },
  );
});

test("allows EBAY_IT stock updates when snapshot currency is EUR", () => {
  assert.deepEqual(
    validateEbayStockCurrency({
      marketplaceId: "EBAY_IT",
      snapshotCurrency: "eur",
    }),
    {
      expectedCurrency: "EUR",
      ok: true,
      reason: null,
      snapshotCurrency: "EUR",
    },
  );
});

test("blocks EBAY_IT stock updates when order currency is missing or not EUR", () => {
  assert.deepEqual(
    validateEbayStockOrderCurrency({
      marketplaceId: "EBAY_IT",
      orderCurrency: undefined,
    }),
    {
      expectedCurrency: "EUR",
      ok: false,
      orderCurrency: null,
      reason: "missing_order_currency",
    },
  );

  assert.deepEqual(
    validateEbayStockOrderCurrency({
      marketplaceId: "EBAY_IT",
      orderCurrency: "USD",
    }),
    {
      expectedCurrency: "EUR",
      ok: false,
      orderCurrency: "USD",
      reason: "currency_mismatch",
    },
  );
});

test("selects Shopify presentment currency before shop currency", () => {
  assert.equal(
    selectShopifyOrderCurrency({
      currency: "EUR",
      presentmentCurrency: "USD",
      shopMoneyCurrency: "EUR",
    }),
    "USD",
  );
  assert.equal(
    selectShopifyOrderCurrency({
      currency: "EUR",
      presentmentMoneyCurrency: "GBP",
      shopMoneyCurrency: "EUR",
    }),
    "GBP",
  );
  assert.equal(
    selectShopifyOrderCurrency({
      currency: "EUR",
      shopMoneyCurrency: "USD",
    }),
    "EUR",
  );
});

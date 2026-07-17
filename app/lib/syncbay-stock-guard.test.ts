import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import {
  getExpectedMarketplaceCurrency,
  isEbayStockDryRunEnabled,
  isEbayStockRealWriteAllowed,
  isPositiveShopifyOrderQuantity,
  selectEbayTradingInventorySku,
  selectShopifyOrderCurrency,
  shouldDryRunEbayStockLine,
  validateEbayStockCurrency,
  validateEbayStockOrderCurrency,
} from "./syncbay-stock-guard.ts";

test("maps EBAY_IT to EUR", () => {
  assert.equal(getExpectedMarketplaceCurrency("EBAY_IT"), "EUR");
});

test("enables stock dry-run only for explicit true", () => {
  assert.equal(isEbayStockDryRunEnabled("true"), true);
  assert.equal(isEbayStockDryRunEnabled("TRUE"), true);
  assert.equal(isEbayStockDryRunEnabled("false"), false);
  assert.equal(isEbayStockDryRunEnabled(undefined), false);
});

test("omits generated SyncBay fallback SKU from eBay Trading stock updates", () => {
  assert.equal(
    selectEbayTradingInventorySku({
      itemId: "168148953253",
      sku: "EBAY-168148953253",
      skuGenerated: true,
    }),
    null,
  );
  assert.equal(
    selectEbayTradingInventorySku({
      itemId: "168148953253",
      sku: " ebay-168148953253 ",
      skuGenerated: true,
    }),
    null,
  );
});

test("preserves real seller SKU even when it matches SyncBay fallback shape", () => {
  assert.equal(
    selectEbayTradingInventorySku({
      itemId: "168148953253",
      sku: "EBAY-168148953253",
      skuGenerated: false,
    }),
    "EBAY-168148953253",
  );
  assert.equal(
    selectEbayTradingInventorySku({
      itemId: "168148953253",
      sku: "EBAY-168148953253",
    }),
    "EBAY-168148953253",
  );
  assert.equal(
    selectEbayTradingInventorySku({
      itemId: "168148953253",
      sku: "SELLER-SKU-1",
      skuGenerated: false,
    }),
    "SELLER-SKU-1",
  );
});

test("keeps stock writes in dry-run unless a line is explicitly allowlisted", () => {
  const line = {
    ebayItemId: "168148953253",
    shopDomain: "fixture-shop.myshopify.com",
    shopifyVariantGid: "gid://shopify/ProductVariant/48298582016222",
    stockDryRunEnabled: true,
  };

  assert.equal(shouldDryRunEbayStockLine(line), true);
  assert.equal(
    shouldDryRunEbayStockLine({
      ...line,
      allowlist: "fixture-shop.myshopify.com:168148953253",
    }),
    false,
  );
  assert.equal(
    shouldDryRunEbayStockLine({
      ...line,
      allowlist: "variant:48298582016222",
    }),
    false,
  );
  assert.equal(
    shouldDryRunEbayStockLine({
      ...line,
      stockDryRunEnabled: false,
    }),
    false,
  );
});

test("matches stock real-write allowlist tokens narrowly", () => {
  assert.equal(
    isEbayStockRealWriteAllowed({
      allowlist:
        "ebay:168148953253 fixture-shop.myshopify.com:variant:48298582016222",
      ebayItemId: "168148953253",
      shopDomain: "fixture-shop.myshopify.com",
      shopifyVariantGid: "gid://shopify/ProductVariant/48298582016222",
    }),
    true,
  );
  assert.equal(
    isEbayStockRealWriteAllowed({
      allowlist:
        "168148953254 fixture-shop.myshopify.com:variant:48298582016223",
      ebayItemId: "168148953253",
      shopDomain: "fixture-shop.myshopify.com",
      shopifyVariantGid: "gid://shopify/ProductVariant/48298582016222",
    }),
    false,
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

test("allows marketplaces without a configured stock currency guard", () => {
  assert.deepEqual(
    validateEbayStockCurrency({
      marketplaceId: "EBAY_DE",
      snapshotCurrency: undefined,
    }),
    {
      expectedCurrency: null,
      ok: true,
      reason: null,
      snapshotCurrency: null,
    },
  );

  assert.deepEqual(
    validateEbayStockOrderCurrency({
      marketplaceId: "EBAY_DE",
      orderCurrency: undefined,
    }),
    {
      expectedCurrency: null,
      ok: true,
      orderCurrency: null,
      reason: null,
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
  assert.equal(
    selectShopifyOrderCurrency({
      shopMoneyCurrency: "usd",
    }),
    "USD",
  );
});

test("accepts only positive integer Shopify order quantities for stock updates", () => {
  assert.equal(isPositiveShopifyOrderQuantity(1), true);
  assert.equal(isPositiveShopifyOrderQuantity(2), true);
  assert.equal(isPositiveShopifyOrderQuantity(1.5), false);
  assert.equal(isPositiveShopifyOrderQuantity(0), false);
  assert.equal(isPositiveShopifyOrderQuantity(-1), false);
});

import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { getShopifyWebhookJobPayload } from "./syncbay-shopify-webhook.ts";

test("extracts paid order currency and line items for eBay stock jobs", () => {
  const payload = getShopifyWebhookJobPayload("orders/paid", {
    currency: "EUR",
    current_total_price_set: {
      presentment_money: { currency_code: "EUR" },
      shop_money: { currency_code: "EUR" },
    },
    line_items: [
      {
        id: 123,
        product_id: 9231310520542,
        quantity: 1,
        variant_id: 48298613407966,
      },
    ],
    presentment_currency: "EUR",
  });

  assert.deepEqual(payload, {
    lineItems: [
      {
        lineItemKey: "123",
        quantity: 1,
        shopifyProductGid: "gid://shopify/Product/9231310520542",
        shopifyVariantGid: "gid://shopify/ProductVariant/48298613407966",
      },
    ],
    orderCurrency: "EUR",
  });
});

test("builds stable line item keys when Shopify omits the line item id", () => {
  const payload = getShopifyWebhookJobPayload("orders/paid", {
    currency: "EUR",
    line_items: [
      {
        product_id: "9231310520542",
        quantity: 2,
        variant_id: "48298613407966",
      },
    ],
  });

  assert.deepEqual(payload, {
    lineItems: [
      {
        lineItemKey: "9231310520542:48298613407966:0",
        quantity: 2,
        shopifyProductGid: "gid://shopify/Product/9231310520542",
        shopifyVariantGid: "gid://shopify/ProductVariant/48298613407966",
      },
    ],
    orderCurrency: "EUR",
  });
});

test("drops invalid paid order lines before queueing stock work", () => {
  const payload = getShopifyWebhookJobPayload("orders/paid", {
    currency: "EUR",
    line_items: [
      { id: 1, product_id: 10, quantity: 0, variant_id: 20 },
      { id: 2, product_id: 11, quantity: -1, variant_id: 21 },
      null,
      "not-a-line",
    ],
  });

  assert.deepEqual(payload, {
    lineItems: [],
    orderCurrency: "EUR",
  });
});

test("extracts inventory item gid for inventory level webhooks", () => {
  assert.deepEqual(
    getShopifyWebhookJobPayload("inventory_levels/update", {
      inventory_item_id: 50426676904158,
    }),
    {
      inventoryItemGid: "gid://shopify/InventoryItem/50426676904158",
    },
  );
});

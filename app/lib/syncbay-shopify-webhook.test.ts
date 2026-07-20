import assert from "node:assert/strict";
import { test } from "vitest";

import {
  getShopifyWebhookJobPayload,
  normalizeShopifyWebhookTopic,
} from "./syncbay-shopify-webhook.ts";

test("normalizes Shopify enum topics without changing resource underscores", () => {
  assert.equal(normalizeShopifyWebhookTopic("INVENTORY_LEVELS_UPDATE"), "inventory_levels/update");
  assert.equal(normalizeShopifyWebhookTopic("APP_SCOPES_UPDATE"), "app/scopes_update");
  assert.equal(normalizeShopifyWebhookTopic("products/update"), "products/update");
});

test("returns an empty payload for unsupported Shopify webhook topics", () => {
  assert.deepEqual(getShopifyWebhookJobPayload("orders/fulfilled", {}), {});
});

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
    stockAction: "decrement",
  });
});

test("builds stable line item keys when Shopify omits the line item id", () => {
  const payload = getShopifyWebhookJobPayload("orders/paid", {
    currency: "EUR",
    id: 555,
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
        lineItemKey: "555:9231310520542:48298613407966:0",
        quantity: 2,
        shopifyProductGid: "gid://shopify/Product/9231310520542",
        shopifyVariantGid: "gid://shopify/ProductVariant/48298613407966",
      },
    ],
    orderCurrency: "EUR",
    stockAction: "decrement",
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
    stockAction: "decrement",
  });
});

test("drops paid order lines when Shopify sends a non-numeric quantity", () => {
  const payload = getShopifyWebhookJobPayload("orders/paid", {
    line_items: [
      {
        id: 99,
        product_id: 10,
        quantity: "2",
        variant_id: 20,
      },
    ],
  });

  assert.deepEqual(payload, {
    lineItems: [],
    orderCurrency: null,
    stockAction: "decrement",
  });
});

test("drops paid order lines when Shopify sends a fractional quantity", () => {
  const payload = getShopifyWebhookJobPayload("orders/paid", {
    currency: "EUR",
    line_items: [
      {
        id: 99,
        product_id: 10,
        quantity: 1.5,
        variant_id: 20,
      },
    ],
  });

  assert.deepEqual(payload, {
    lineItems: [],
    orderCurrency: "EUR",
    stockAction: "decrement",
  });
});

test("falls back to shop money currency for paid orders when presentment is absent", () => {
  const payload = getShopifyWebhookJobPayload("orders/paid", {
    current_total_price_set: {
      shop_money: { currency_code: "eur" },
    },
    line_items: [],
  });

  assert.deepEqual(payload, {
    lineItems: [],
    orderCurrency: "EUR",
    stockAction: "decrement",
  });
});

test("decrements on order creation and restores conservatively on cancellation", () => {
  const payload = {
    currency: "EUR",
    line_items: [{ id: 123, product_id: 10, quantity: 1, variant_id: 20 }],
  };

  assert.equal(getShopifyWebhookJobPayload("orders/create", payload).stockAction, "decrement");
  assert.equal(getShopifyWebhookJobPayload("orders/cancelled", payload).stockAction, "restore");
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

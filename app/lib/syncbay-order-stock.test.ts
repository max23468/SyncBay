import assert from "node:assert/strict";
import { test } from "vitest";

import {
  getOrderLineMappingLookup,
  getOrderReservationSnapshotLookups,
  getShopifyOrderStockAction,
  getShopifyOrderStockTarget,
} from "./syncbay-order-stock.ts";

test("never falls back from an unmapped Shopify variant to a sibling mapping", () => {
  assert.deepEqual(
    getOrderLineMappingLookup({
      shopifyProductGid: "gid://shopify/Product/1",
      shopifyVariantGid: "gid://shopify/ProductVariant/2",
    }),
    {
      shopifyVariantGid: "gid://shopify/ProductVariant/2",
    },
  );
  assert.deepEqual(
    getOrderLineMappingLookup({
      shopifyProductGid: "gid://shopify/Product/1",
      shopifyVariantGid: null,
    }),
    {
      shopifyProductGid: "gid://shopify/Product/1",
      shopifyVariantGid: null,
    },
  );
});

test("finds reservation snapshots by both order and line identifiers", () => {
  assert.deepEqual(
    getOrderReservationSnapshotLookups({
      lineItemKeys: ["line-1", null, "line-2"],
      orderResourceId: "order-1",
    }),
    [
      { field: "shopifyOrderId", value: "order-1" },
      { field: "orderLineItemKey", value: "line-1" },
      { field: "orderLineItemKey", value: "line-2" },
    ],
  );
});

test("decrements eBay as soon as Shopify commits an order", () => {
  assert.equal(
    getShopifyOrderStockTarget({
      action: "decrement",
      orderQuantity: 2,
      previousQuantity: 5,
    }),
    3,
  );
  assert.equal(
    getShopifyOrderStockTarget({
      action: "decrement",
      orderQuantity: 3,
      previousQuantity: 1,
    }),
    0,
  );
});

test("restores only stock returned by Shopify and caps it at the pre-order level", () => {
  assert.equal(
    getShopifyOrderStockTarget({
      action: "restore",
      ebayAvailableQuantity: 3,
      orderQuantity: 2,
      previousQuantity: 5,
      shopifyAvailableQuantity: 5,
    }),
    5,
  );
  assert.equal(
    getShopifyOrderStockTarget({
      action: "restore",
      ebayAvailableQuantity: 3,
      orderQuantity: 2,
      previousQuantity: 5,
      shopifyAvailableQuantity: 4,
    }),
    4,
  );
  assert.equal(
    getShopifyOrderStockTarget({
      action: "restore",
      ebayAvailableQuantity: 1,
      orderQuantity: 2,
      previousQuantity: 5,
      shopifyAvailableQuantity: 5,
    }),
    3,
  );
});

test("restores every line of a cancelled order up to the pre-order level", () => {
  // Due righe da un pezzo sullo stesso mapping hanno decrementato 5 -> 4 -> 3.
  // Il tetto è la quantità precedente all'ordine, non il pre-decremento della
  // singola riga, altrimenti la seconda riga resterebbe bloccata a 4.
  const orderPreviousQuantity = 5;
  const firstLine = getShopifyOrderStockTarget({
    action: "restore",
    ebayAvailableQuantity: 3,
    orderQuantity: 1,
    previousQuantity: orderPreviousQuantity,
    shopifyAvailableQuantity: 5,
  });

  assert.equal(firstLine, 4);
  assert.equal(
    getShopifyOrderStockTarget({
      action: "restore",
      ebayAvailableQuantity: firstLine,
      orderQuantity: 1,
      previousQuantity: orderPreviousQuantity,
      shopifyAvailableQuantity: 5,
    }),
    5,
  );
});

test("does not restore when either provider quantity cannot be verified", () => {
  assert.equal(
    getShopifyOrderStockTarget({
      action: "restore",
      ebayAvailableQuantity: null,
      orderQuantity: 1,
      previousQuantity: 2,
      shopifyAvailableQuantity: 2,
    }),
    null,
  );
  assert.equal(
    getShopifyOrderStockTarget({
      action: "restore",
      ebayAvailableQuantity: 1,
      orderQuantity: 1,
      previousQuantity: 2,
      shopifyAvailableQuantity: null,
    }),
    null,
  );
});

test("unknown legacy actions remain backward-compatible decrements", () => {
  assert.equal(getShopifyOrderStockAction(undefined), "decrement");
  assert.equal(getShopifyOrderStockAction("restore"), "restore");
  assert.equal(getShopifyOrderStockAction("unexpected"), "decrement");
});

import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildSyncBayProductMetafields, getSyncBayCategorySourceFromMetafields } from "./syncbay-shopify-product-metafields.ts";

test("builds Shopify product metafields for eBay product and store categories", () => {
  assert.deepEqual(
    buildSyncBayProductMetafields({
      ebayItemId: "111222333",
      ebayPrimaryCategoryId: "11116",
      ebayPrimaryCategoryName: "Monete italiane",
      ebayPrimaryCategoryPath: "Monete e banconote > Monete > Italia Regno",
      priceAmount: 42.5,
      quantity: 3,
      sku: "REGNO-001",
      skuGenerated: false,
      storeCategoryId: "1234567890",
      storeCategoryName: "Vittorio Emanuele III",
      storeCategoryPath: "Numismatica > Italia Regno > Vittorio Emanuele III",
    }),
    [
      {
        key: "ebay_item_id",
        namespace: "syncbay",
        type: "single_line_text_field",
        value: "111222333",
      },
      {
        key: "ebay_sku",
        namespace: "syncbay",
        type: "single_line_text_field",
        value: "REGNO-001",
      },
      {
        key: "ebay_price",
        namespace: "syncbay",
        type: "single_line_text_field",
        value: "42.5",
      },
      {
        key: "ebay_quantity",
        namespace: "syncbay",
        type: "single_line_text_field",
        value: "3",
      },
      {
        key: "ebay_category_id",
        namespace: "syncbay",
        type: "single_line_text_field",
        value: "11116",
      },
      {
        key: "ebay_category_name",
        namespace: "syncbay",
        type: "single_line_text_field",
        value: "Monete italiane",
      },
      {
        key: "ebay_category_path",
        namespace: "syncbay",
        type: "single_line_text_field",
        value: "Monete e banconote > Monete > Italia Regno",
      },
      {
        key: "ebay_store_category_id",
        namespace: "syncbay",
        type: "single_line_text_field",
        value: "1234567890",
      },
      {
        key: "ebay_store_category_name",
        namespace: "syncbay",
        type: "single_line_text_field",
        value: "Vittorio Emanuele III",
      },
      {
        key: "ebay_store_category_path",
        namespace: "syncbay",
        type: "single_line_text_field",
        value: "Numismatica > Italia Regno > Vittorio Emanuele III",
      },
    ],
  );
});

test("reads eBay category source back from Shopify product metafields", () => {
  assert.deepEqual(
    getSyncBayCategorySourceFromMetafields([
      { key: "ebay_category_id", value: "11116" },
      { key: "ebay_category_name", value: "Monete italiane" },
      {
        key: "ebay_category_path",
        value: "Monete e banconote > Monete > Italia Regno",
      },
      { key: "ebay_store_category_id", value: "1234567890" },
      { key: "ebay_store_category_name", value: "Vittorio Emanuele III" },
      {
        key: "ebay_store_category_path",
        value: "Numismatica > Italia Regno > Vittorio Emanuele III",
      },
      { key: "ebay_price", value: "42.5" },
    ]),
    {
      ebayPrimaryCategoryId: "11116",
      ebayPrimaryCategoryName: "Monete italiane",
      ebayPrimaryCategoryPath: "Monete e banconote > Monete > Italia Regno",
      storeCategoryId: "1234567890",
      storeCategoryName: "Vittorio Emanuele III",
      storeCategoryPath: "Numismatica > Italia Regno > Vittorio Emanuele III",
    },
  );
});

test("returns null when Shopify metafields do not contain category data", () => {
  assert.equal(
    getSyncBayCategorySourceFromMetafields([
      { key: "ebay_item_id", value: "111222333" },
      { key: "ebay_category_name", value: " " },
    ]),
    null,
  );
});

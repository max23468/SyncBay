import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { getEbayStorefrontMetadata } from "./syncbay-ebay-storefront.ts";

test("extracts assigned eBay store category id and name", () => {
  assert.deepEqual(
    getEbayStorefrontMetadata({
      StoreCategoryID: "1234567890",
      StoreCategoryName: "Monete italiane",
    }),
    { storeCategoryId: "1234567890", storeCategoryName: "Monete italiane" },
  );
});

test("trims whitespace around eBay-supplied storefront values", () => {
  assert.deepEqual(
    getEbayStorefrontMetadata({
      StoreCategoryID: " 42 ",
      StoreCategoryName: "  Banconote  ",
    }),
    { storeCategoryId: "42", storeCategoryName: "Banconote" },
  );
});

test("treats default eBay placeholder ids as no store category", () => {
  assert.deepEqual(
    getEbayStorefrontMetadata({ StoreCategoryID: "0" }),
    { storeCategoryId: null, storeCategoryName: null },
  );

  assert.deepEqual(
    getEbayStorefrontMetadata({ StoreCategoryID: "-999" }),
    { storeCategoryId: null, storeCategoryName: null },
  );

  assert.deepEqual(
    getEbayStorefrontMetadata({
      StoreCategoryID: "0",
      StoreCategoryName: "Categorie del negozio",
    }),
    { storeCategoryId: null, storeCategoryName: null },
  );
});

test("accepts numeric store category ids parsed by the XML reader", () => {
  assert.deepEqual(
    getEbayStorefrontMetadata({
      StoreCategoryID: 99,
      StoreCategoryName: "Numismatica",
    }),
    { storeCategoryId: "99", storeCategoryName: "Numismatica" },
  );
});

test("returns nulls when the listing has no Storefront block", () => {
  assert.deepEqual(getEbayStorefrontMetadata(undefined), {
    storeCategoryId: null,
    storeCategoryName: null,
  });
  assert.deepEqual(getEbayStorefrontMetadata(null), {
    storeCategoryId: null,
    storeCategoryName: null,
  });
  assert.deepEqual(getEbayStorefrontMetadata("not-an-object"), {
    storeCategoryId: null,
    storeCategoryName: null,
  });
});

test("empty StoreCategoryName collapses to null instead of empty string", () => {
  assert.deepEqual(
    getEbayStorefrontMetadata({
      StoreCategoryID: "42",
      StoreCategoryName: "   ",
    }),
    { storeCategoryId: "42", storeCategoryName: null },
  );
});

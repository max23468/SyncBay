import assert from "node:assert/strict";
import test from "node:test";

import { buildShopifyProductUpdateFieldsFromDraft } from "./syncbay-shopify-product-update-fields.ts";

test("includes Shopify taxonomy category and product type when updating a reused product", () => {
  const fields = buildShopifyProductUpdateFieldsFromDraft({
    product: {
      category: "gid://shopify/TaxonomyCategory/ae-2-2-2-2",
      descriptionHtml: "<p>Descrizione eBay</p>",
      productType: "Monete italiane",
      status: "ACTIVE",
      title: "Moneta rara",
    },
    productId: "gid://shopify/Product/123",
  });

  assert.deepEqual(fields, {
    category: "gid://shopify/TaxonomyCategory/ae-2-2-2-2",
    descriptionHtml: "<p>Descrizione eBay</p>",
    id: "gid://shopify/Product/123",
    productType: "Monete italiane",
    status: "ACTIVE",
    title: "Moneta rara",
  });
});

test("omits category fields when the category proposal is not applicable", () => {
  const fields = buildShopifyProductUpdateFieldsFromDraft({
    product: {
      descriptionHtml: "<p>Descrizione eBay</p>",
      status: "ACTIVE",
      title: "Oggetto da collezione",
    },
    productId: "gid://shopify/Product/123",
  });

  assert.deepEqual(fields, {
    descriptionHtml: "<p>Descrizione eBay</p>",
    id: "gid://shopify/Product/123",
    status: "ACTIVE",
    title: "Oggetto da collezione",
  });
});

import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as shopifyExistingProducts from "./shopify-existing-products.server.ts";

const { loadExistingShopifyProductsForMatching } = shopifyExistingProducts;

test("loads existing Shopify products across pages up to the requested limit", async () => {
  const calls: Array<Record<string, unknown> | undefined> = [];
  const admin = {
    async graphql(_query: string, options?: { variables?: Record<string, unknown> }) {
      calls.push(options?.variables);
      const pageIndex = calls.length;

      return jsonResponse({
        data: {
          products: {
            nodes:
              pageIndex === 1
                ? [
                    makeProductNode("1", {
                      handle: "moneta-1001",
                      metafields: [{ key: "ebay_item_id", namespace: "syncbay", value: "1001" }],
                      sku: "COIN-1001",
                      tags: ["EBAY-1001"],
                      title: " Moneta argento ",
                      variantId: "11",
                    }),
                    makeProductNode("2", {
                      handle: "banconota-1002",
                      sku: "BANK-1002",
                      title: "Banconota",
                      variantId: "22",
                    }),
                  ]
                : [
                    makeProductNode("3", {
                      handle: "medaglia-1003",
                      sku: "MEDAL-1003",
                      title: "Medaglia",
                      variantId: "33",
                    }),
                  ],
            pageInfo:
              pageIndex === 1
                ? { endCursor: "cursor-1", hasNextPage: true }
                : { endCursor: "cursor-2", hasNextPage: false },
          },
        },
      });
    },
  };

  const products = await loadExistingShopifyProductsForMatching(admin, { limit: 3 });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((variables) => variables?.after ?? null), [null, "cursor-1"]);
  assert.deepEqual(
    products.map((product) => product.productGid),
    [
      "gid://shopify/Product/1",
      "gid://shopify/Product/2",
      "gid://shopify/Product/3",
    ],
  );
  assert.equal(products[0]?.title, "Moneta argento");
  assert.equal(products[0]?.handle, "moneta-1001");
  assert.equal(products[0]?.sku, "COIN-1001");
  assert.equal(products[0]?.variantGid, "gid://shopify/ProductVariant/11");
  assert.deepEqual(products[0]?.tags, ["EBAY-1001"]);
  assert.deepEqual(products[0]?.metafields, [
    { key: "ebay_item_id", namespace: "syncbay", value: "1001" },
  ]);
});

test("counts the Shopify limit by product nodes instead of variant candidates", async () => {
  const calls: Array<Record<string, unknown> | undefined> = [];
  const admin = {
    async graphql(
      _query: string,
      options?: { variables?: Record<string, unknown> },
    ) {
      calls.push(options?.variables);

      return jsonResponse({
        data: {
          products: {
            nodes: [
              makeProductNode("1", {
                handle: "album-varianti",
                sku: "ALBUM-A",
                title: "Album con varianti",
                variantId: "11",
                variantSkus: ["ALBUM-A", "ALBUM-B"],
              }),
              makeProductNode("2", {
                handle: "moneta-singola",
                sku: "COIN-2",
                title: "Moneta singola",
                variantId: "21",
              }),
            ],
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      });
    },
  };

  const products = await loadExistingShopifyProductsForMatching(admin, {
    limit: 2,
  });

  assert.deepEqual(calls.map((variables) => variables?.first), [2]);
  assert.deepEqual(
    products.map((product) => product.productGid),
    [
      "gid://shopify/Product/1",
      "gid://shopify/Product/1",
      "gid://shopify/Product/2",
    ],
  );
  assert.deepEqual(
    products.map((product) => product.sku),
    ["ALBUM-A", "ALBUM-B", "COIN-2"],
  );
});

function makeProductNode(
  id: string,
  input: {
    handle: string;
    metafields?: Array<{ key: string; namespace: string; value: string }>;
    sku: string;
    tags?: string[];
    title: string;
    variantId: string;
    variantSkus?: string[];
  },
) {
  const variantSkus = input.variantSkus ?? [input.sku];

  return {
    handle: input.handle,
    id: `gid://shopify/Product/${id}`,
    metafields: {
      nodes: input.metafields ?? [],
    },
    tags: input.tags ?? [],
    title: input.title,
    variants: {
      nodes: variantSkus.map((sku, index) => ({
        barcode: null,
        id: `gid://shopify/ProductVariant/${Number(input.variantId) + index}`,
        sku,
      })),
    },
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

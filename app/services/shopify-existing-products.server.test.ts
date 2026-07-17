import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as shopifyExistingProducts from "./shopify-existing-products.server.ts";

const { loadExistingShopifyProductsForMatching } = shopifyExistingProducts;

test("loads existing Shopify products across pages up to the requested limit", async () => {
  const calls: Array<Record<string, unknown> | undefined> = [];
  const admin = {
    async graphql(
      _query: string,
      options?: { variables?: Record<string, unknown> },
    ) {
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
                      metafields: [
                        {
                          key: "ebay_item_id",
                          namespace: "syncbay",
                          value: "1001",
                        },
                      ],
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

  const products = await loadExistingShopifyProductsForMatching(admin, {
    limit: 3,
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((variables) => variables?.after ?? null),
    [null, "cursor-1"],
  );
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

  assert.deepEqual(
    calls.map((variables) => variables?.first),
    [2],
  );
  assert.deepEqual(
    calls.map((variables) => variables?.variantFirst),
    [10],
  );
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

test("allows existing catalog matching scans above the private eBay import cap", async () => {
  const calls: Array<Record<string, unknown> | undefined> = [];
  const admin = {
    async graphql(
      _query: string,
      options?: { variables?: Record<string, unknown> },
    ) {
      calls.push(options?.variables);
      const first = Number(options?.variables?.first ?? 0);
      const start = (calls.length - 1) * first;
      const nodes = Array.from({ length: first }, (_, index) =>
        makeProductNode(String(start + index + 1), {
          handle: `prodotto-${start + index + 1}`,
          sku: `SKU-${start + index + 1}`,
          title: `Prodotto ${start + index + 1}`,
          variantId: String(start + index + 1),
        }),
      );

      return jsonResponse({
        data: {
          products: {
            nodes,
            pageInfo: {
              endCursor: `cursor-${calls.length}`,
              hasNextPage: calls.length < 12,
            },
          },
        },
      });
    },
  };

  const products = await loadExistingShopifyProductsForMatching(admin, {
    limit: 3000,
  });

  assert.equal(calls.length, 12);
  assert.equal(products.length, 3000);
  assert.equal(products.at(-1)?.sku, "SKU-3000");
});

test("caps variant candidates per product before matching", async () => {
  const admin = {
    async graphql(
      _query: string,
      options?: { variables?: Record<string, unknown> },
    ) {
      const variantLimit = Number(options?.variables?.variantFirst ?? 0);

      return jsonResponse({
        data: {
          products: {
            nodes: [
              makeProductNode("1", {
                handle: "set-varianti",
                sku: "SET-1",
                title: "Set varianti",
                variantId: "10",
                variantSkus: Array.from(
                  { length: Math.max(variantLimit + 5, 15) },
                  (_, index) => `SET-${index + 1}`,
                ).slice(0, variantLimit),
              }),
            ],
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      });
    },
  };

  const products = await loadExistingShopifyProductsForMatching(admin, {
    limit: 1,
  });

  assert.equal(products.length, 10);
  assert.equal(products.at(0)?.sku, "SET-1");
  assert.equal(products.at(-1)?.sku, "SET-10");
});

test("marks variant candidates as truncated when Shopify has more variants", async () => {
  const admin = {
    async graphql() {
      return jsonResponse({
        data: {
          products: {
            nodes: [
              makeProductNode("1", {
                handle: "set-varianti-1001",
                sku: "SET-1",
                title: "Set varianti",
                variantId: "10",
                variantPageInfoHasNextPage: true,
                variantSkus: ["SET-1", "SET-2"],
              }),
            ],
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      });
    },
  };

  const products = await loadExistingShopifyProductsForMatching(admin, {
    limit: 1,
  });

  assert.deepEqual(
    products.map((product) => product.variantsTruncated),
    [true, true],
  );
});

test("counts only Shopify image media for takeover matching", async () => {
  let queryText = "";
  const admin = {
    async graphql(query: string) {
      queryText = query;

      return jsonResponse({
        data: {
          products: {
            nodes: [
              makeProductNode("1", {
                handle: "solo-video",
                mediaContentTypes: ["VIDEO", "MODEL_3D"],
                sku: "VIDEO-1",
                title: "Solo video",
                variantId: "10",
              }),
              makeProductNode("2", {
                handle: "con-immagine",
                mediaContentTypes: ["IMAGE"],
                sku: "IMG-2",
                title: "Con immagine",
                variantId: "20",
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

  assert.match(queryText, /media\(first: 1, query: "media_type:IMAGE"\)/);
  assert.deepEqual(
    products.map((product) => product.shopifyImageCount),
    [0, 1],
  );
});

test("loads targeted Shopify variants by SKU hints outside the product scan window", async () => {
  const calls: Array<{ query: string; variables?: Record<string, unknown> }> =
    [];
  const admin = {
    async graphql(
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) {
      calls.push({ query, variables: options?.variables });

      if (query.includes("productVariants")) {
        return jsonResponse({
          data: {
            productVariants: {
              nodes: [
                {
                  barcode: null,
                  id: "gid://shopify/ProductVariant/990",
                  sku: "168172909275",
                  product: {
                    handle: "moneta-fuori-finestra",
                    id: "gid://shopify/Product/99",
                    metafields: {
                      nodes: [],
                    },
                    tags: ["Area_Italia"],
                    title: "Moneta fuori finestra",
                  },
                },
              ],
              pageInfo: { endCursor: null, hasNextPage: false },
            },
          },
        });
      }

      return jsonResponse({
        data: {
          products: {
            nodes: [
              makeProductNode("1", {
                handle: "prodotto-recente",
                sku: "RECENT-1",
                title: "Prodotto recente",
                variantId: "10",
              }),
            ],
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      });
    },
  };

  const products = await loadExistingShopifyProductsForMatching(admin, {
    limit: 1,
    skuHints: ["168172909275"],
  });

  assert.equal(calls.length, 2);
  assert.match(calls[1]?.query ?? "", /productVariants\(first: \$first/);
  assert.doesNotMatch(calls[1]?.query ?? "", /media\(/);
  assert.match(String(calls[1]?.variables?.query ?? ""), /sku:168172909275/);
  assert.deepEqual(
    products.map((product) => product.sku),
    ["RECENT-1", "168172909275"],
  );
  assert.equal(products[1]?.productGid, "gid://shopify/Product/99");
  assert.equal(products[1]?.variantGid, "gid://shopify/ProductVariant/990");
  assert.equal(products[1]?.shopifyImageCount, 0);
  assert.deepEqual(products[1]?.tags, ["Area_Italia"]);
  // Il candidato mirato carica solo la variante SKU: va marcato truncated
  // per evitare auto-link product-level sulla singola variante.
  assert.equal(products[1]?.variantsTruncated, true);
});

test("can prefer targeted SKU hints before a bounded fallback product scan", async () => {
  const calls: Array<{ query: string; variables?: Record<string, unknown> }> =
    [];
  const admin = {
    async graphql(
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) {
      calls.push({ query, variables: options?.variables });

      if (query.includes("productVariants")) {
        return jsonResponse({
          data: {
            productVariants: {
              nodes: [
                {
                  barcode: null,
                  id: "gid://shopify/ProductVariant/990",
                  sku: "168172909275",
                  product: {
                    handle: "moneta-targeted",
                    id: "gid://shopify/Product/99",
                    metafields: {
                      nodes: [],
                    },
                    tags: ["SyncBay"],
                    title: "Moneta targeted",
                  },
                },
              ],
              pageInfo: { endCursor: null, hasNextPage: false },
            },
          },
        });
      }

      return jsonResponse({
        data: {
          products: {
            nodes: [
              makeProductNode("1", {
                handle: "fallback-recente",
                sku: "RECENT-1",
                title: "Fallback recente",
                variantId: "10",
              }),
            ],
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      });
    },
  };

  const products = await loadExistingShopifyProductsForMatching(admin, {
    fallbackScanLimit: 1,
    limit: 10000,
    preferTargetedSkuHints: true,
    skuHints: ["168172909275"],
  });

  assert.match(calls[0]?.query ?? "", /productVariants\(first: \$first/);
  assert.match(calls[1]?.query ?? "", /products\(first: \$first/);
  assert.equal(calls[1]?.variables?.first, 1);
  assert.deepEqual(
    products.map((product) => product.sku),
    ["RECENT-1", "168172909275"],
  );
});

test("preserves scanned image counts on targeted matches for the same product", async () => {
  const admin = {
    async graphql(query: string) {
      if (query.includes("productVariants")) {
        return jsonResponse({
          data: {
            productVariants: {
              nodes: [
                {
                  barcode: null,
                  id: "gid://shopify/ProductVariant/991",
                  sku: "COIN-TARGETED",
                  product: {
                    handle: "moneta-con-immagini",
                    id: "gid://shopify/Product/77",
                    metafields: { nodes: [] },
                    tags: [],
                    title: "Moneta con immagini",
                  },
                },
              ],
              pageInfo: { endCursor: null, hasNextPage: false },
            },
          },
        });
      }

      return jsonResponse({
        data: {
          products: {
            nodes: [
              makeProductNode("77", {
                handle: "moneta-con-immagini",
                mediaContentTypes: ["IMAGE", "IMAGE"],
                sku: "COIN-SCAN",
                title: "Moneta con immagini",
                variantId: "770",
              }),
            ],
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      });
    },
  };

  const products = await loadExistingShopifyProductsForMatching(admin, {
    fallbackScanLimit: 1,
    limit: 10000,
    preferTargetedSkuHints: true,
    skuHints: ["COIN-TARGETED"],
  });

  const targeted = products.find((product) => product.sku === "COIN-TARGETED");
  // Il prodotto è anche nello scan con 2 immagini: il candidato mirato eredita
  // il conteggio reale invece di restare a 0 e declassare la riga a review.
  assert.equal(targeted?.shopifyImageCount, 2);
});

function makeProductNode(
  id: string,
  input: {
    handle: string;
    mediaContentTypes?: string[];
    metafields?: Array<{ key: string; namespace: string; value: string }>;
    sku: string;
    tags?: string[];
    title: string;
    variantId: string;
    variantPageInfoHasNextPage?: boolean;
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
    media: {
      nodes: (input.mediaContentTypes ?? []).map((mediaContentType, index) => ({
        id: `gid://shopify/Media/${id}-${index}`,
        mediaContentType,
      })),
    },
    tags: input.tags ?? [],
    title: input.title,
    variants: {
      nodes: variantSkus.map((sku, index) => ({
        barcode: null,
        id: `gid://shopify/ProductVariant/${Number(input.variantId) + index}`,
        sku,
      })),
      pageInfo: {
        hasNextPage: input.variantPageInfoHasNextPage ?? false,
      },
    },
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

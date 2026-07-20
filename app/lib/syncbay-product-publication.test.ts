import assert from "node:assert/strict";
import { test } from "vitest";

import {
  loadShopifyProductPublications,
  syncShopifyProductPublications,
} from "./syncbay-product-publication.ts";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
    ...init,
  });
}

test("publishes active products to every Shopify publication", async () => {
  const calls: Array<{ query: string; variables?: Record<string, unknown> }> = [];
  const admin = {
    async graphql(query: string, options?: { variables?: Record<string, unknown> }) {
      calls.push({ query, variables: options?.variables });

      if (query.includes("query SyncBayProductPublications")) {
        return jsonResponse({
          data: {
            publications: {
              nodes: [{ id: "gid://shopify/Publication/1" }, { id: "gid://shopify/Publication/2" }],
              pageInfo: { endCursor: null, hasNextPage: false },
            },
          },
        });
      }

      return jsonResponse({
        data: {
          publishablePublish: {
            publishable: { id: "gid://shopify/Product/123" },
            userErrors: [],
          },
        },
      });
    },
  };

  const result = await syncShopifyProductPublications(admin, {
    id: "gid://shopify/Product/123",
    status: "ACTIVE",
  });

  assert.equal(result.status, "synced");
  assert.equal(result.publicationCount, 2);
  assert.deepEqual(calls[1]?.variables, {
    id: "gid://shopify/Product/123",
    input: [
      { publicationId: "gid://shopify/Publication/1" },
      { publicationId: "gid://shopify/Publication/2" },
    ],
  });
});

test("does not publish draft products", async () => {
  let graphqlCalls = 0;
  const admin = {
    async graphql() {
      graphqlCalls += 1;
      return jsonResponse({});
    },
  };

  const result = await syncShopifyProductPublications(admin, {
    id: "gid://shopify/Product/123",
    status: "DRAFT",
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "product_not_active");
  assert.equal(graphqlCalls, 0);
});

test("reports Shopify publication user errors as a failed sync", async () => {
  const admin = {
    async graphql(query: string) {
      if (query.includes("query SyncBayProductPublications")) {
        return jsonResponse({
          data: {
            publications: {
              nodes: [{ id: "gid://shopify/Publication/1" }],
              pageInfo: { endCursor: null, hasNextPage: false },
            },
          },
        });
      }

      return jsonResponse({
        data: {
          publishablePublish: {
            publishable: null,
            userErrors: [{ field: ["input"], message: "Missing access scope" }],
          },
        },
      });
    },
  };

  const result = await syncShopifyProductPublications(admin, {
    id: "gid://shopify/Product/123",
    status: "ACTIVE",
  });

  assert.equal(result.status, "failed");
  assert.match(result.errorMessage, /Missing access scope/);
});

test("reuses preloaded publication ids without querying publications", async () => {
  const calls: Array<{ query: string; variables?: Record<string, unknown> }> = [];
  const admin = {
    async graphql(query: string, options?: { variables?: Record<string, unknown> }) {
      calls.push({ query, variables: options?.variables });

      return jsonResponse({
        data: {
          publishablePublish: {
            publishable: { id: "gid://shopify/Product/123" },
            userErrors: [],
          },
        },
      });
    },
  };

  const result = await syncShopifyProductPublications(
    admin,
    {
      id: "gid://shopify/Product/123",
      status: "ACTIVE",
    },
    {
      publicationIds: ["gid://shopify/Publication/1"],
    },
  );

  assert.equal(result.status, "synced");
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.query ?? "", /mutation SyncBayPublishProduct/);
  assert.deepEqual(calls[0]?.variables, {
    id: "gid://shopify/Product/123",
    input: [{ publicationId: "gid://shopify/Publication/1" }],
  });
});

test("loads publication labels from catalog titles", async () => {
  const admin = {
    async graphql() {
      return jsonResponse({
        data: {
          publications: {
            nodes: [
              {
                catalog: { title: "Online Store" },
                id: "gid://shopify/Publication/1",
              },
            ],
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      });
    },
  };

  assert.deepEqual(await loadShopifyProductPublications(admin), [
    {
      id: "gid://shopify/Publication/1",
      title: "Online Store",
    },
  ]);
});

test("prefers publication names over technical catalog titles", async () => {
  const admin = {
    async graphql() {
      return jsonResponse({
        data: {
          publications: {
            nodes: [
              {
                catalog: {
                  title: "Channel Catalog 56084758573 1b6391b6-26de-4e9d-8e05-470aee25b648",
                },
                id: "gid://shopify/Publication/56084758573",
                name: "Negozio online",
              },
            ],
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      });
    },
  };

  assert.deepEqual(await loadShopifyProductPublications(admin), [
    {
      id: "gid://shopify/Publication/56084758573",
      title: "Negozio online",
    },
  ]);
});

test("keeps readable custom catalog titles ahead of publication names", async () => {
  const admin = {
    async graphql() {
      return jsonResponse({
        data: {
          publications: {
            nodes: [
              {
                catalog: { title: "Mercato Italia B2B" },
                id: "gid://shopify/Publication/42",
                name: "Negozio online",
              },
            ],
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      });
    },
  };

  assert.deepEqual(await loadShopifyProductPublications(admin), [
    {
      id: "gid://shopify/Publication/42",
      title: "Mercato Italia B2B",
    },
  ]);
});

test("falls back to publication names when catalog titles are missing", async () => {
  const admin = {
    async graphql() {
      return jsonResponse({
        data: {
          publications: {
            nodes: [
              {
                catalog: null,
                id: "gid://shopify/Publication/1",
                name: "Online Store",
              },
            ],
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      });
    },
  };

  assert.deepEqual(await loadShopifyProductPublications(admin), [
    {
      id: "gid://shopify/Publication/1",
      title: "Online Store",
    },
  ]);
});

test("can explicitly skip sales channel publication", async () => {
  let graphqlCalls = 0;
  const admin = {
    async graphql() {
      graphqlCalls += 1;
      return jsonResponse({});
    },
  };

  const result = await syncShopifyProductPublications(
    admin,
    {
      id: "gid://shopify/Product/123",
      status: "ACTIVE",
    },
    { disabled: true },
  );

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "publication_disabled");
  assert.equal(graphqlCalls, 0);
});

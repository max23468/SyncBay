import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { createShopifyAdminGraphqlClient, getOfflineShopifySessionId } from "./syncbay-shopify-admin.ts";

test("builds the offline Shopify session id used by Shopify apps", () => {
  assert.equal(
    getOfflineShopifySessionId("syncbay-dev.myshopify.com"),
    "offline_syncbay-dev.myshopify.com",
  );
});

test("creates an Admin GraphQL client backed by the offline access token", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const client = createShopifyAdminGraphqlClient({
    accessToken: "shpat_test",
    fetch: async (input, init) => {
      calls.push({ input, init });

      return new Response(JSON.stringify({ data: { shop: { name: "SyncBay" } } }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    },
    shopDomain: "syncbay-dev.myshopify.com",
  });

  const response = await client.graphql("query Test($id: ID!) { node(id: $id) { id } }", {
    variables: { id: "gid://shopify/Product/1" },
  });

  assert.equal(response.ok, true);
  assert.equal(
    String(calls[0]?.input),
    "https://syncbay-dev.myshopify.com/admin/api/2026-07/graphql.json",
  );
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(
    (calls[0]?.init?.headers as Record<string, string>)?.[
      "X-Shopify-Access-Token"
    ],
    "shpat_test",
  );
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    query: "query Test($id: ID!) { node(id: $id) { id } }",
    variables: { id: "gid://shopify/Product/1" },
  });
});

test("retries throttled Admin GraphQL responses", async () => {
  let callCount = 0;
  const client = createShopifyAdminGraphqlClient({
    accessToken: "shpat_test",
    fetch: async () => {
      callCount += 1;

      if (callCount === 1) {
        return new Response(
          JSON.stringify({ errors: [{ message: "Throttled" }] }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        );
      }

      return new Response(JSON.stringify({ data: { ok: true } }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    },
    policy: { maxAttempts: 2, throttleRetryDelayMs: 1 },
    shopDomain: "syncbay-dev.myshopify.com",
  });

  const response = await client.graphql("query Test { shop { id } }");

  assert.equal(callCount, 2);
  assert.deepEqual(await response.json(), { data: { ok: true } });
});

test("retries Admin GraphQL responses with throttled extension codes", async () => {
  let callCount = 0;
  const client = createShopifyAdminGraphqlClient({
    accessToken: "shpat_test",
    fetch: async () => {
      callCount += 1;

      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            errors: [
              {
                extensions: { code: "THROTTLED" },
                message: "Request cost exceeded currently available points",
              },
            ],
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        );
      }

      return new Response(JSON.stringify({ data: { ok: true } }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    },
    policy: { maxAttempts: 2, throttleRetryDelayMs: 1 },
    shopDomain: "syncbay-dev.myshopify.com",
  });

  const response = await client.graphql("query Test { shop { id } }");

  assert.equal(callCount, 2);
  assert.deepEqual(await response.json(), { data: { ok: true } });
});

test("normalizes repeated non-json Admin GraphQL responses", async () => {
  const client = createShopifyAdminGraphqlClient({
    accessToken: "shpat_test",
    fetch: async () =>
      new Response("<html><h1>Temporarily unavailable</h1></html>", {
        headers: { "Content-Type": "text/html" },
        status: 200,
      }),
    policy: { maxAttempts: 2, retryDelayMs: 1 },
    shopDomain: "syncbay-dev.myshopify.com",
  });

  const response = await client.graphql("query Test { shop { id } }");
  const json = await response.json();

  assert.equal(response.ok, false);
  assert.equal(response.status, 502);
  assert.match(
    json.errors[0].message,
    /risposta non JSON/,
  );
});

test("never exceeds four Admin GraphQL fetch attempts by default", async () => {
  let calls = 0;
  const client = createShopifyAdminGraphqlClient({
    accessToken: "shpat_test",
    fetch: async () => {
      calls += 1;
      return new Response("unavailable", { status: 503 });
    },
    shopDomain: "syncbay-dev.myshopify.com",
    sleep: async () => {},
  });

  await client.graphql("query Test { shop { id } }");
  assert.equal(calls, 4);
});

test("stops before the retry delay would exceed the elapsed-time budget", async () => {
  let calls = 0;
  let elapsed = 0;
  const client = createShopifyAdminGraphqlClient({
    accessToken: "shpat_test",
    fetch: async () => {
      calls += 1;
      return new Response("unavailable", { status: 503 });
    },
    now: () => elapsed,
    policy: { maxAttempts: 10, maxElapsedMs: 4_000, retryDelayMs: 2_000 },
    shopDomain: "syncbay-dev.myshopify.com",
    sleep: async (ms) => { elapsed += ms; },
  });

  await client.graphql("query Test { shop { id } }");
  assert.equal(calls, 2);
  assert.equal(elapsed, 2_000);
});

test("uses Shopify throttle status and GraphQL cost in one retry decision", async () => {
  const delays: number[] = [];
  let calls = 0;
  const client = createShopifyAdminGraphqlClient({
    accessToken: "shpat_test",
    fetch: async () => {
      calls += 1;
      return new Response(JSON.stringify(calls === 1 ? {
        errors: [{ extensions: { code: "THROTTLED" }, message: "Throttled" }],
        extensions: { cost: { requestedQueryCost: 100, throttleStatus: { currentlyAvailable: 10, restoreRate: 10 } } },
      } : { data: { ok: true } }), { headers: { "Content-Type": "application/json" } });
    },
    policy: { throttleRetryDelayMs: 1 },
    shopDomain: "syncbay-dev.myshopify.com",
    sleep: async (ms) => { delays.push(ms); },
  });

  await client.graphql("query Test { shop { id } }");
  assert.deepEqual(delays, [9_000]);
  assert.equal(calls, 2);
});

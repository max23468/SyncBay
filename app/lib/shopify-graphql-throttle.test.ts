import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { isShopifyGraphqlThrottleResponse } from "./shopify-graphql-throttle.ts";

test("detects Shopify GraphQL throttle responses by HTTP status", () => {
  assert.equal(
    isShopifyGraphqlThrottleResponse({ envelope: null, status: 429 }),
    true,
  );
});

test("detects Shopify GraphQL throttle responses by extension code", () => {
  assert.equal(
    isShopifyGraphqlThrottleResponse({
      envelope: {
        errors: [
          {
            extensions: { code: "THROTTLED" },
            message: "Request cost exceeded currently available points",
          },
        ],
      },
      status: 200,
    }),
    true,
  );
});

test("detects Shopify GraphQL throttle responses by message", () => {
  assert.equal(
    isShopifyGraphqlThrottleResponse({
      envelope: { errors: [{ message: "Throttled" }] },
      status: 200,
    }),
    true,
  );
});

test("ignores malformed Shopify GraphQL error envelopes", () => {
  assert.equal(
    isShopifyGraphqlThrottleResponse({
      envelope: { errors: { message: "Throttled" } },
      status: 200,
    }),
    false,
  );
});

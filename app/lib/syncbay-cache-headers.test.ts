import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as cacheHeaders from "./syncbay-cache-headers.ts";

const { getEmbeddedNoStoreHeaders } = cacheHeaders;

test("adds no-store headers without dropping existing boundary headers", () => {
  const headers = getEmbeddedNoStoreHeaders({
    "X-Shopify-API-Request-Failure-Reauthorize": "1",
  });

  assert.equal(headers.get("Cache-Control"), "no-store, max-age=0");
  assert.equal(headers.get("CDN-Cache-Control"), "no-store");
  assert.equal(headers.get("Vercel-CDN-Cache-Control"), "no-store");
  assert.equal(
    headers.get("X-Shopify-API-Request-Failure-Reauthorize"),
    "1",
  );
});

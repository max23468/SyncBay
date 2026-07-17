import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import {
  readFreshThumbnailCacheEntries,
  writeThumbnailCacheEntries,
} from "./syncbay-thumbnail-cache.ts";

test("returns fresh thumbnail cache hits and misses", () => {
  const cache = new Map();
  cache.set("gid://shopify/Product/1", {
    expiresAt: 1_100,
    value: "https://cdn.shopify.example/1.jpg",
  });
  cache.set("gid://shopify/Product/2", {
    expiresAt: 900,
    value: "https://cdn.shopify.example/2.jpg",
  });

  const result = readFreshThumbnailCacheEntries({
    cache,
    keys: [
      "gid://shopify/Product/1",
      "gid://shopify/Product/2",
      "gid://shopify/Product/3",
    ],
    nowMs: 1_000,
  });

  assert.equal(
    result.hits.get("gid://shopify/Product/1"),
    "https://cdn.shopify.example/1.jpg",
  );
  assert.deepEqual(result.misses, [
    "gid://shopify/Product/2",
    "gid://shopify/Product/3",
  ]);
  assert.equal(cache.has("gid://shopify/Product/2"), false);
});

test("caches misses so repeated page loads avoid immediate fallback queries", () => {
  const cache = new Map();
  const values = new Map([
    ["gid://shopify/Product/1", "https://cdn.shopify.example/1.jpg"],
  ]);

  writeThumbnailCacheEntries({
    cache,
    keys: ["gid://shopify/Product/1", "gid://shopify/Product/2"],
    nowMs: 1_000,
    ttlMs: 60_000,
    values,
  });

  assert.deepEqual(cache.get("gid://shopify/Product/1"), {
    expiresAt: 61_000,
    value: "https://cdn.shopify.example/1.jpg",
  });
  assert.deepEqual(cache.get("gid://shopify/Product/2"), {
    expiresAt: 61_000,
    value: null,
  });
});

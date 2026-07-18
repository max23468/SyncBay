import assert from "node:assert/strict";
import { test } from "vitest";

import { shouldRefreshOfflineShopifySession } from "./syncbay-shopify-session-refresh.ts";

test("refreshes non-expiring offline Shopify sessions for Shopify 2027 readiness", () => {
  assert.equal(
    shouldRefreshOfflineShopifySession(
      null,
      new Date("2026-06-03T10:00:00.000Z"),
    ),
    true,
  );
});

test("refreshes expired offline Shopify sessions", () => {
  assert.equal(
    shouldRefreshOfflineShopifySession(
      new Date("2026-06-03T09:59:00.000Z"),
      new Date("2026-06-03T10:00:00.000Z"),
    ),
    true,
  );
});

test("refreshes offline Shopify sessions inside the safety window", () => {
  assert.equal(
    shouldRefreshOfflineShopifySession(
      new Date("2026-06-03T10:04:59.000Z"),
      new Date("2026-06-03T10:00:00.000Z"),
    ),
    true,
  );
});

test("keeps fresh expiring offline Shopify sessions usable", () => {
  assert.equal(
    shouldRefreshOfflineShopifySession(
      new Date("2026-06-03T10:05:01.000Z"),
      new Date("2026-06-03T10:00:00.000Z"),
    ),
    false,
  );
});

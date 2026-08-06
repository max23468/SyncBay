import assert from "node:assert/strict";
import { test } from "vitest";

import { callEbayTradingApi } from "./ebay-trading-api.server.ts";

test("uses the latest eBay Trading API compatibility level", async () => {
  const originalFetch = globalThis.fetch;
  let compatibilityLevel: string | null = null;

  globalThis.fetch = async (_url, init) => {
    compatibilityLevel =
      (init?.headers as Record<string, string>)?.["X-EBAY-API-COMPATIBILITY-LEVEL"] ?? null;
    return new Response("<GetItemResponse><Ack>Success</Ack></GetItemResponse>");
  };

  try {
    await callEbayTradingApi({
      accessToken: "test-token",
      callName: "GetItem",
      connection: { environment: "sandbox", marketplaceId: "EBAY_IT" },
      requestXml: "<GetItemRequest />",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(compatibilityLevel, "1455");
});

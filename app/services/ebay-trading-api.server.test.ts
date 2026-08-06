import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("loads the Trading modules through native Node ESM", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      "await Promise.all([import('./app/services/ebay-trading-api.server.ts'), import('./app/lib/syncbay-ebay-trading-bulk.ts')])",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
});

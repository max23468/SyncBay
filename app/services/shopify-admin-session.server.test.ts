import assert from "node:assert/strict";
import test from "node:test";

import { encryptSecret } from "./crypto.server";
import { getUsableOfflineShopifySessionWithPorts } from "./shopify-admin-session.server";

process.env.TOKEN_ENCRYPTION_KEY = "syncbay-admin-session-test-key";

function row(accessToken: string, refreshToken: string) {
  return {
    accessToken: encryptSecret(accessToken),
    expires: new Date("2026-07-11T10:00:00Z"),
    refreshToken: encryptSecret(refreshToken),
    refreshTokenExpires: new Date("2026-08-11T10:00:00Z"),
    scope: "read_products",
  };
}

test("refreshes outside persistence and then uses compare-and-swap", async () => {
  const events: string[] = [];
  const result = await getUsableOfflineShopifySessionWithPorts({
    compareAndSwap: async () => { events.push("compare-and-swap"); return true; },
    now: () => new Date("2026-07-11T10:00:00Z"),
    readSession: async () => { events.push("read-session"); return row("old", "refresh"); },
    refresh: async () => {
      events.push("refresh-http");
      return {
        accessToken: "new",
        expiresAt: new Date("2026-07-11T11:00:00Z"),
        refreshToken: "new-refresh",
        refreshTokenExpiresAt: new Date("2026-10-11T10:00:00Z"),
      };
    },
  });

  assert.deepEqual(events, ["read-session", "refresh-http", "compare-and-swap"]);
  assert.equal(result.accessToken, "new");
});

test("rereads the winning session after losing compare-and-swap", async () => {
  const rows = [row("old", "refresh"), row("winner", "winner-refresh")];
  const result = await getUsableOfflineShopifySessionWithPorts({
    compareAndSwap: async () => false,
    now: () => new Date("2026-07-11T10:00:00Z"),
    readSession: async () => rows.shift() ?? null,
    refresh: async () => ({
      accessToken: "loser",
      expiresAt: new Date("2026-07-11T11:00:00Z"),
      refreshToken: "loser-refresh",
      refreshTokenExpiresAt: new Date("2026-10-11T10:00:00Z"),
    }),
  });

  assert.equal(result.accessToken, "winner");
});

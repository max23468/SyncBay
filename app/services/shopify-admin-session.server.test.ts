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

test("recovers the winning session when refresh throws after losing the race", async () => {
  const rows = [row("old", "refresh"), row("winner", "winner-refresh")];
  const result = await getUsableOfflineShopifySessionWithPorts({
    compareAndSwap: async () => {
      throw new Error("compare-and-swap non dovrebbe essere raggiunto");
    },
    now: () => new Date("2026-07-11T10:00:00Z"),
    readSession: async () => rows.shift() ?? null,
    refresh: async () => {
      throw new Error("Refresh token Shopify offline non riuscito (HTTP 400).");
    },
  });

  assert.equal(result.accessToken, "winner");
});

test("rethrows when refresh fails and the session is unchanged", async () => {
  const refreshError = new Error(
    "Refresh token Shopify offline non riuscito (HTTP 400).",
  );
  // Il DB restituisce la stessa riga cifrata su ogni lettura quando nessun
  // altro runner ha ruotato la sessione: nessun vincitore da recuperare.
  const stored = row("old", "refresh");
  await assert.rejects(
    getUsableOfflineShopifySessionWithPorts({
      compareAndSwap: async () => true,
      now: () => new Date("2026-07-11T10:00:00Z"),
      readSession: async () => stored,
      refresh: async () => {
        throw refreshError;
      },
    }),
    refreshError,
  );
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

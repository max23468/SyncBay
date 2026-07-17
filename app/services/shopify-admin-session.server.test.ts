import assert from "node:assert/strict";
import test from "node:test";

import { encryptSecret } from "./crypto.server";
import {
  dedupeInFlight,
  getUsableOfflineShopifySessionWithPorts,
} from "./shopify-admin-session.server";

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
    compareAndSwap: async () => {
      events.push("compare-and-swap");
      return true;
    },
    now: () => new Date("2026-07-11T10:00:00Z"),
    readSession: async () => {
      events.push("read-session");
      return row("old", "refresh");
    },
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

  assert.deepEqual(events, [
    "read-session",
    "refresh-http",
    "compare-and-swap",
  ]);
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
  let reads = 0;
  const sleeps: number[] = [];
  await assert.rejects(
    getUsableOfflineShopifySessionWithPorts({
      compareAndSwap: async () => true,
      now: () => new Date("2026-07-11T10:00:00Z"),
      readSession: async () => {
        reads += 1;
        return stored;
      },
      refresh: async () => {
        throw refreshError;
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    }),
    refreshError,
  );
  // Lettura iniziale + una rilettura per ogni finestra di recupero.
  assert.equal(reads, 4);
  assert.deepEqual(sleeps, [500, 1500]);
});

test("recovers a winner that persists only after a delayed re-read", async () => {
  // Il vincitore scrive "in ritardo": le prime riletture vedono ancora la
  // sessione vecchia (stessa riga cifrata), solo dopo la seconda attesa
  // compare quella nuova.
  const stored = row("old", "refresh");
  const rows = [stored, stored, stored, row("winner", "winner-refresh")];
  const sleeps: number[] = [];
  const logged: { level: string; outcome: string }[] = [];
  const result = await getUsableOfflineShopifySessionWithPorts({
    compareAndSwap: async () => {
      throw new Error("compare-and-swap non dovrebbe essere raggiunto");
    },
    log: ({ level, outcome }) => logged.push({ level, outcome }),
    now: () => new Date("2026-07-11T10:00:00Z"),
    readSession: async () => rows.shift() ?? null,
    refresh: async () => {
      throw new Error("Refresh token Shopify offline non riuscito (HTTP 401).");
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  assert.equal(result.accessToken, "winner");
  assert.deepEqual(sleeps, [500, 1500]);
  assert.deepEqual(logged, [
    { level: "warn", outcome: "refresh-fallito-riusata-sessione-vincente" },
  ]);
});

test("logs the http status when refresh fails without a winner", async () => {
  const refreshError = new Error(
    "Refresh token Shopify offline non riuscito (HTTP 401).",
  ) as Error & { status?: number };
  refreshError.status = 401;
  const stored = row("old", "refresh");
  const logged: string[] = [];
  await assert.rejects(
    getUsableOfflineShopifySessionWithPorts({
      compareAndSwap: async () => true,
      log: ({ outcome }) => logged.push(outcome),
      now: () => new Date("2026-07-11T10:00:00Z"),
      readSession: async () => stored,
      refresh: async () => {
        throw refreshError;
      },
      sleep: async () => {},
    }),
    refreshError,
  );
  assert.deepEqual(logged, ["refresh-fallito-http-401"]);
});

test("logs a successful refresh that wins compare-and-swap", async () => {
  const logged: { level: string; outcome: string }[] = [];
  const result = await getUsableOfflineShopifySessionWithPorts({
    compareAndSwap: async () => true,
    log: ({ level, outcome }) => logged.push({ level, outcome }),
    now: () => new Date("2026-07-11T10:00:00Z"),
    readSession: async () => row("old", "refresh"),
    refresh: async () => ({
      accessToken: "new",
      expiresAt: new Date("2026-07-11T11:00:00Z"),
      refreshToken: "new-refresh",
      refreshTokenExpiresAt: new Date("2026-10-11T10:00:00Z"),
    }),
  });

  assert.equal(result.accessToken, "new");
  assert.deepEqual(logged, [
    { level: "info", outcome: "refresh-riuscito-e-persistito" },
  ]);
});

test("dedupes concurrent in-flight session loads by key", async () => {
  const map = new Map<string, Promise<unknown>>();
  let creations = 0;
  let release: (value: string) => void = () => {};
  const create = () => {
    creations += 1;
    return new Promise<string>((resolve) => {
      release = resolve;
    });
  };

  const first = dedupeInFlight(map, "offline_shop", create);
  const second = dedupeInFlight(map, "offline_shop", create);
  const other = dedupeInFlight(map, "offline_altro-shop", async () => "altro");

  release("session");
  assert.deepEqual(await Promise.all([first, second, other]), [
    "session",
    "session",
    "altro",
  ]);
  // Un solo refresh per i due chiamanti concorrenti sullo stesso shop.
  assert.equal(creations, 1);
  // A promise conclusa la mappa si svuota: la prossima chiamata rilegge.
  assert.equal(map.size, 0);
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

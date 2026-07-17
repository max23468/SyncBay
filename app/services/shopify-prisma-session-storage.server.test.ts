import assert from "node:assert/strict";
import test from "node:test";

import { Session as ShopifySession } from "@shopify/shopify-api";

import { PrismaSessionStorage } from "./shopify-prisma-session-storage.server.ts";
import { encryptSecret } from "./crypto.server";

process.env.TOKEN_ENCRYPTION_KEY = "syncbay-session-storage-test-key";

type StoredSessionRow = {
  id: string;
  shop: string;
  state: string;
  isOnline: boolean;
  scope: string | null;
  expires: Date | null;
  accessToken: string;
  userId: number | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  accountOwner: boolean | null;
  locale: string | null;
  collaborator: boolean | null;
  emailVerified: boolean | null;
  refreshToken: string | null;
  refreshTokenExpires: Date | null;
};

type StoredSessionRowWrite = Omit<
  StoredSessionRow,
  "accountOwner" | "collaborator" | "emailVerified"
> & {
  accountOwner: boolean;
  collaborator: boolean;
  emailVerified: boolean;
};

test("stores and loads Shopify sessions through the Prisma session table", async () => {
  const rows = new Map<string, StoredSessionRow>();
  const storage = new PrismaSessionStorage(
    {
      session: {
        count: async () => rows.size,
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: { id: string };
          create: StoredSessionRowWrite;
          update: StoredSessionRowWrite;
        }) => {
          rows.set(where.id, rows.has(where.id) ? update : create);
        },
        findUnique: async ({ where }: { where: { id: string } }) =>
          rows.get(where.id) ?? null,
        delete: async ({ where }: { where: { id: string } }) => {
          rows.delete(where.id);
        },
        deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
          for (const id of where.id.in) rows.delete(id);
        },
        findMany: async ({ where }: { where: { shop: string } }) =>
          [...rows.values()].filter((row) => row.shop === where.shop),
      },
    },
    { connectionRetries: 1, connectionRetryIntervalMs: 0 },
  );

  const expires = new Date("2026-01-02T03:04:05.000Z");
  const session = new ShopifySession({
    id: "offline_test-shop.myshopify.com",
    shop: "test-shop.myshopify.com",
    state: "state",
    isOnline: false,
    scope: "read_products,write_products",
    expires,
    accessToken: "token",
  });

  assert.equal(await storage.isReady(), true);
  assert.equal(await storage.storeSession(session), true);

  const persisted = rows.get(session.id);
  assert.notEqual(persisted?.accessToken, "token");
  assert.equal(persisted?.accessToken.startsWith("v1."), true);

  const loaded = await storage.loadSession(session.id);

  assert.equal(loaded?.id, session.id);
  assert.equal(loaded?.shop, session.shop);
  assert.equal(loaded?.scope, session.scope);
  assert.equal(loaded?.accessToken, session.accessToken);
  assert.equal(loaded?.expires?.toISOString(), expires.toISOString());
  assert.equal(await storage.storeSession(loaded!), true);
  assert.equal(rows.get(session.id)?.accessToken.startsWith("v1."), true);
  assert.equal((await storage.loadSession(session.id))?.accessToken, "token");
  assert.deepEqual(
    (await storage.findSessionsByShop(session.shop)).map((row) => row.id),
    [session.id],
  );

  assert.equal(await storage.deleteSession(session.id), true);
  assert.equal(await storage.loadSession(session.id), undefined);
});

test("rejects plaintext legacy session tokens after the compatible rollout", async () => {
  const row = makeStoredSessionRow(1, "legacy.myshopify.com");
  row.accessToken = "legacy-access-token";
  row.refreshToken = "legacy-refresh-token";
  const storage = new PrismaSessionStorage(
    {
      session: {
        count: async () => 1,
        upsert: async () => {},
        findUnique: async () => row,
        delete: async () => {},
        deleteMany: async () => {},
        findMany: async () => [row],
      },
    },
    { connectionRetries: 1, connectionRetryIntervalMs: 0 },
  );

  await assert.rejects(
    storage.loadSession(row.id),
    /Sessione Shopify non cifrata o non valida/,
  );
});

test("loads tokenless OAuth state sessions without throwing", async () => {
  const rows = new Map<string, StoredSessionRow>();
  const storage = new PrismaSessionStorage(
    {
      session: {
        count: async () => rows.size,
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: { id: string };
          create: StoredSessionRowWrite;
          update: StoredSessionRowWrite;
        }) => {
          rows.set(where.id, rows.has(where.id) ? update : create);
        },
        findUnique: async ({ where }: { where: { id: string } }) =>
          rows.get(where.id) ?? null,
        delete: async () => {},
        deleteMany: async () => {},
        findMany: async () => [],
      },
    },
    { connectionRetries: 1, connectionRetryIntervalMs: 0 },
  );

  const stateSession = new ShopifySession({
    id: "offline_state-shop.myshopify.com",
    shop: "state-shop.myshopify.com",
    state: "nonce",
    isOnline: false,
  });

  assert.equal(await storage.storeSession(stateSession), true);
  assert.equal(rows.get(stateSession.id)?.accessToken, "");

  const loaded = await storage.loadSession(stateSession.id);

  assert.equal(loaded?.id, stateSession.id);
  assert.equal(loaded?.state, "nonce");
  assert.equal(loaded?.accessToken ?? "", "");
});

test("ignores missing rows but propagates failed session deletes", async () => {
  const missingRowError = Object.assign(new Error("record not found"), {
    code: "P2025",
  });
  const missingRowStorage = new PrismaSessionStorage(
    {
      session: {
        count: async () => 1,
        upsert: async () => {},
        findUnique: async () => null,
        delete: async () => {
          throw missingRowError;
        },
        deleteMany: async () => {},
        findMany: async () => [],
      },
    },
    { connectionRetries: 1, connectionRetryIntervalMs: 0 },
  );

  assert.equal(await missingRowStorage.deleteSession("missing"), true);

  const failedDeleteStorage = new PrismaSessionStorage(
    {
      session: {
        count: async () => 1,
        upsert: async () => {},
        findUnique: async () => null,
        delete: async () => {
          throw new Error("database unavailable");
        },
        deleteMany: async () => {},
        findMany: async () => [],
      },
    },
    { connectionRetries: 1, connectionRetryIntervalMs: 0 },
  );

  await assert.rejects(
    () => failedDeleteStorage.deleteSession("still-stored"),
    /database unavailable/,
  );
});

test("returns every persisted session for a shop", async () => {
  const findManyInputs: unknown[] = [];
  const rows = Array.from({ length: 30 }, (_, index) =>
    makeStoredSessionRow(index + 1, "many-sessions.myshopify.com"),
  ).map((row) => ({
    ...row,
    accessToken: encryptSecret(row.accessToken),
    refreshToken: row.refreshToken ? encryptSecret(row.refreshToken) : null,
  }));
  const storage = new PrismaSessionStorage(
    {
      session: {
        count: async () => rows.length,
        upsert: async () => {},
        findUnique: async () => null,
        delete: async () => {},
        deleteMany: async () => {},
        findMany: async (input: unknown) => {
          findManyInputs.push(input);

          return rows;
        },
      },
    },
    { connectionRetries: 1, connectionRetryIntervalMs: 0 },
  );

  const sessions = await storage.findSessionsByShop(
    "many-sessions.myshopify.com",
  );

  assert.equal(sessions.length, 30);
  assert.equal(sessions.at(0)?.id, "session-1");
  assert.equal("take" in (findManyInputs[0] as Record<string, unknown>), false);
});

test("reports readiness failures without throwing from isReady", async () => {
  const storage = new PrismaSessionStorage(
    {
      session: {
        count: async () => {
          throw new Error("missing table");
        },
        upsert: async () => {},
        findUnique: async () => null,
        delete: async () => {},
        deleteMany: async () => {},
        findMany: async () => [],
      },
    },
    { connectionRetries: 1, connectionRetryIntervalMs: 0 },
  );

  assert.equal(await storage.isReady(), false);
});

function makeStoredSessionRow(index: number, shop: string): StoredSessionRow {
  return {
    accessToken: `token-${index}`,
    accountOwner: null,
    collaborator: null,
    email: null,
    emailVerified: null,
    expires: null,
    firstName: null,
    id: `session-${index}`,
    isOnline: true,
    lastName: null,
    locale: null,
    refreshToken: null,
    refreshTokenExpires: null,
    scope: "read_products",
    shop,
    state: `state-${index}`,
    userId: index,
  };
}

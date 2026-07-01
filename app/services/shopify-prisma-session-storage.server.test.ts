import assert from "node:assert/strict";
import test from "node:test";

import { Session as ShopifySession } from "@shopify/shopify-api";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { PrismaSessionStorage } from "./shopify-prisma-session-storage.server.ts";

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

  const loaded = await storage.loadSession(session.id);

  assert.equal(loaded?.id, session.id);
  assert.equal(loaded?.shop, session.shop);
  assert.equal(loaded?.scope, session.scope);
  assert.equal(loaded?.accessToken, session.accessToken);
  assert.equal(loaded?.expires?.toISOString(), expires.toISOString());
  assert.deepEqual(
    (await storage.findSessionsByShop(session.shop)).map((row) => row.id),
    [session.id],
  );

  assert.equal(await storage.deleteSession(session.id), true);
  assert.equal(await storage.loadSession(session.id), undefined);
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

import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  auditCreate: vi.fn(async () => ({ id: "audit-1" })),
  coalesced: true,
  createMany: vi.fn(async () => ({ count: 1 })),
}));

vi.mock("../db.server", () => ({
  default: {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        $queryRaw: async () => [],
        auditLog: { create: fakes.auditCreate },
        shop: {
          findUniqueOrThrow: async () => ({ installationStatus: "INSTALLED" }),
          upsert: async () => ({ id: "shop-1" }),
        },
        syncJob: {
          create: async () => ({ id: "job-1" }),
          createMany: fakes.createMany,
          findFirst: async () => (fakes.coalesced ? { id: "job-existing" } : null),
          updateMany: async () => ({ count: 1 }),
        },
      }),
  },
}));

import { recordShopifyWebhookPlaceholder } from "./syncbay-operations.server";

beforeEach(() => {
  vi.clearAllMocks();
  fakes.coalesced = true;
});

test("registra l’audit webhook solo quando crea una nuova traccia job", async () => {
  const input = {
    resourceId: "gid://shopify/Product/1",
    shopDomain: "synthetic.myshopify.com",
    topic: "products/update",
    webhookId: "webhook-1",
  };

  await recordShopifyWebhookPlaceholder(input);
  assert.equal(fakes.auditCreate.mock.calls.length, 0);

  fakes.coalesced = false;
  await recordShopifyWebhookPlaceholder({ ...input, webhookId: "webhook-2" });
  assert.equal(fakes.createMany.mock.calls.length, 1);
  assert.equal(fakes.auditCreate.mock.calls.length, 1);
});

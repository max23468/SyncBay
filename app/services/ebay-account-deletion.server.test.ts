import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  connectionFindMany: vi.fn(),
  deletionFindFirst: vi.fn(),
  deletionFindUnique: vi.fn(),
  deletionUpsert: vi.fn(),
}));

vi.mock("../db.server", () => ({
  default: {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        auditLog: { create: vi.fn(), createMany: vi.fn() },
        ebayAccountDeletionRequest: { upsert: fakes.deletionUpsert },
        ebayConnection: { updateMany: vi.fn() },
        ebayOAuthState: { deleteMany: vi.fn() },
        productMapping: { deleteMany: vi.fn() },
        productSnapshot: { deleteMany: vi.fn() },
        shop: { updateMany: vi.fn() },
        syncConflict: { deleteMany: vi.fn() },
        syncJob: { updateMany: vi.fn() },
      }),
    ebayAccountDeletionRequest: {
      findFirst: fakes.deletionFindFirst,
      findUnique: fakes.deletionFindUnique,
      update: vi.fn(),
      upsert: fakes.deletionUpsert,
    },
    ebayConnection: { findMany: fakes.connectionFindMany },
  },
}));

vi.mock("./crypto.server", () => ({
  encryptSecret: (value: string) => `encrypted:${value}`,
  hashSecretIdentifier: () => "hashed-user",
}));

vi.mock("./ebay-notifications.server", () => ({
  EbayNotificationSignatureError: class EbayNotificationSignatureError extends Error {},
  verifyEbayNotificationSignature: async () => ({ keyId: "synthetic-key" }),
}));

import { processEbayAccountDeletionNotification } from "./ebay-account-deletion.server.ts";

beforeEach(() => {
  vi.clearAllMocks();
  fakes.deletionFindUnique.mockResolvedValue(null);
  fakes.deletionFindFirst.mockResolvedValue(null);
  fakes.connectionFindMany.mockResolvedValue([]);
  fakes.deletionUpsert.mockImplementation(
    async ({ create }: { create: Record<string, unknown> }) => ({
      id: "request-1",
      matchedShopCount: create.matchedShopCount,
      status: create.status,
    }),
  );
});

test("custodisce per il relay anche una notifica senza corrispondenze SyncBay", async () => {
  const body = notificationBody("notification-1");

  const result = await processEbayAccountDeletionNotification({
    body,
    lookupBudgetKey: "synthetic",
    signatureHeader: "synthetic-signature",
  });

  assert.equal(result.status, "NO_MATCH");
  assert.equal(result.requestId, "request-1");
  const create = fakes.deletionUpsert.mock.calls[0]?.[0].create;
  assert.equal(create.relayStatus, "PENDING");
  assert.equal(create.encryptedRelayBody, `encrypted:${body.toString("base64")}`);
  assert.equal(create.encryptedRelaySignature, "encrypted:synthetic-signature");
});

test("crea un relay distinto per un nuovo notificationId già deduplicato localmente", async () => {
  fakes.deletionFindFirst.mockResolvedValue({
    id: "request-original",
    matchedShopCount: 1,
    status: "PROCESSED",
  });
  fakes.deletionUpsert.mockResolvedValue({
    id: "request-duplicate",
    matchedShopCount: 1,
    status: "PROCESSED",
  });

  const result = await processEbayAccountDeletionNotification({
    body: notificationBody("notification-2"),
    lookupBudgetKey: "synthetic",
    signatureHeader: "synthetic-signature",
  });

  assert.equal(result.requestId, "request-duplicate");
  assert.equal(result.duplicateOfRequestId, "request-original");
  assert.equal(fakes.deletionUpsert.mock.calls[0]?.[0].create.notificationId, "notification-2");
  assert.equal(fakes.deletionUpsert.mock.calls[0]?.[0].create.relayStatus, "PENDING");
});

function notificationBody(notificationId: string) {
  return Buffer.from(
    JSON.stringify({
      metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" },
      notification: {
        data: { userId: "synthetic-user" },
        eventDate: "2026-09-08T08:00:00.000Z",
        notificationId,
        publishAttemptCount: 1,
        publishDate: "2026-09-08T08:00:01.000Z",
      },
    }),
  );
}

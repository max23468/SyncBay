import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  findFirst: vi.fn(async (_input: unknown) => null as Record<string, unknown> | null),
  updateMany: vi.fn(
    async (_input: { data: Record<string, unknown>; where: Record<string, unknown> }) => ({
      count: 1,
    }),
  ),
}));

vi.mock("../db.server", () => ({
  default: {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        ebayAccountDeletionRequest: {
          findFirst: fakes.findFirst,
          updateMany: fakes.updateMany,
        },
      }),
    ebayAccountDeletionRequest: {
      updateMany: fakes.updateMany,
    },
  },
}));

vi.mock("./crypto.server", () => ({
  decryptSecret: (value: string) =>
    value === "encrypted-body"
      ? Buffer.from('{"notification":"synthetic"}').toString("base64")
      : "synthetic-signature",
}));

import {
  forwardEbayAccountDeletionToHubFatture,
  getEbayAccountDeletionRelayRetryAt,
  runDueEbayAccountDeletionRelays,
} from "./ebay-account-deletion-relay.server.ts";

afterEach(() => {
  delete process.env.HUB_FATTURE_EBAY_ACCOUNT_DELETION_URL;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("inoltra a Hub Fatture il payload account deletion e la firma eBay originali", async () => {
  const body = Buffer.from('{"notification":{"notificationId":"synthetic"}}');
  const calls: Array<{ body: Uint8Array; headers: Headers; method: string; redirect: string }> = [];
  vi.stubGlobal("fetch", async (_input: URL, init?: RequestInit) => {
    calls.push({
      body: init?.body as Uint8Array,
      headers: new Headers(init?.headers),
      method: init?.method ?? "",
      redirect: init?.redirect ?? "",
    });
    return new Response(null, { status: 204 });
  });

  try {
    await forwardEbayAccountDeletionToHubFatture({
      body,
      endpoint: "https://fatture.example.invalid/webhooks/ebay/account-deletion",
      signatureHeader: "synthetic-signature",
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[0]?.redirect, "error");
    assert.equal(calls[0]?.headers.get("Content-Type"), "application/json");
    assert.equal(calls[0]?.headers.get("X-EBAY-SIGNATURE"), "synthetic-signature");
    assert.deepEqual(Buffer.from(calls[0]!.body), body);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("fallisce chiuso quando Hub Fatture non accetta la notifica", async () => {
  vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }));

  try {
    await assert.rejects(
      forwardEbayAccountDeletionToHubFatture({
        body: Buffer.from("{}"),
        endpoint: "https://fatture.example.invalid/webhooks/ebay/account-deletion",
        signatureHeader: "synthetic-signature",
      }),
      /HTTP 503/,
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

test("rifiuta un relay non HTTPS", async () => {
  await assert.rejects(
    forwardEbayAccountDeletionToHubFatture({
      body: Buffer.from("{}"),
      endpoint: "http://fatture.example.invalid/webhooks/ebay/account-deletion",
      signatureHeader: "synthetic-signature",
    }),
    /non configurato correttamente/,
  );
});

test("aumenta il backoff fino a un'ora senza esaurire i retry", () => {
  const now = new Date("2026-09-08T08:00:00.000Z");
  assert.equal(
    getEbayAccountDeletionRelayRetryAt(1, now).toISOString(),
    "2026-09-08T08:01:00.000Z",
  );
  assert.equal(
    getEbayAccountDeletionRelayRetryAt(2, now).toISOString(),
    "2026-09-08T08:05:00.000Z",
  );
  assert.equal(
    getEbayAccountDeletionRelayRetryAt(3, now).toISOString(),
    "2026-09-08T08:15:00.000Z",
  );
  assert.equal(
    getEbayAccountDeletionRelayRetryAt(99, now).toISOString(),
    "2026-09-08T09:00:00.000Z",
  );
});

test("consegna un envelope cifrato e cancella i valori dopo il successo", async () => {
  process.env.HUB_FATTURE_EBAY_ACCOUNT_DELETION_URL =
    "https://fatture.example.invalid/webhooks/ebay/account-deletion";
  fakes.findFirst
    .mockResolvedValueOnce({
      encryptedRelayBody: "encrypted-body",
      encryptedRelaySignature: "encrypted-signature",
      id: "relay-1",
      relayAttemptCount: 0,
      relayStartedAt: null,
      relayStatus: "PENDING",
    })
    .mockResolvedValueOnce(null);
  vi.stubGlobal("fetch", async () => new Response(null, { status: 204 }));

  const summary = await runDueEbayAccountDeletionRelays({
    now: new Date("2026-09-08T08:00:00.000Z"),
  });

  assert.deepEqual(summary, {
    attemptedCount: 1,
    configured: true,
    continuationNeeded: false,
    deliveredCount: 1,
    failedCount: 0,
  });
  assert.equal(fakes.updateMany.mock.calls.length, 2);
  const deliveredUpdate = fakes.updateMany.mock.calls[1]?.[0];
  assert.ok(deliveredUpdate);
  assert.deepEqual(deliveredUpdate.data, {
    encryptedRelayBody: null,
    encryptedRelaySignature: null,
    relayLastErrorCode: null,
    relayNextAttemptAt: null,
    relayStartedAt: null,
    relayStatus: "DELIVERED",
    relayedAt: deliveredUpdate.data.relayedAt,
  });
  assert.ok(deliveredUpdate.data.relayedAt instanceof Date);
});

test("mantiene l'envelope e pianifica il retry quando Hub Fatture non risponde", async () => {
  const now = new Date("2026-09-08T08:00:00.000Z");
  process.env.HUB_FATTURE_EBAY_ACCOUNT_DELETION_URL =
    "https://fatture.example.invalid/webhooks/ebay/account-deletion";
  fakes.findFirst
    .mockResolvedValueOnce({
      encryptedRelayBody: "encrypted-body",
      encryptedRelaySignature: "encrypted-signature",
      id: "relay-2",
      relayAttemptCount: 0,
      relayStartedAt: null,
      relayStatus: "PENDING",
    })
    .mockResolvedValueOnce(null);
  vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }));

  const summary = await runDueEbayAccountDeletionRelays({ now });

  assert.equal(summary.failedCount, 1);
  const retryUpdate = fakes.updateMany.mock.calls[1]?.[0];
  assert.ok(retryUpdate);
  assert.deepEqual(retryUpdate.data, {
    relayLastErrorCode: "HUB_FATTURE_RELAY_FAILED",
    relayNextAttemptAt: new Date("2026-09-08T08:01:00.000Z"),
    relayStartedAt: null,
    relayStatus: "RETRYING",
  });
});

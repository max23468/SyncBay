import assert from "node:assert/strict";
import { test, vi } from "vitest";

import {
  EbayNotificationSignatureError,
  verifyEbayNotificationSignature,
} from "./ebay-notifications.server";

test("rejects attacker-controlled public key IDs before provider lookup", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const signatureHeader = Buffer.from(
    JSON.stringify({
      kid: "https://attacker.example/key",
      signature: "c3ludGhldGlj",
    }),
  ).toString("base64");

  await assert.rejects(
    verifyEbayNotificationSignature({
      body: Buffer.from("{}"),
      lookupBudgetKey: "synthetic-source",
      signatureHeader,
    }),
    (error: unknown) =>
      error instanceof EbayNotificationSignatureError && error.code === "signature_malformed",
  );
  assert.equal(fetchMock.mock.calls.length, 0);

  vi.unstubAllGlobals();
});

test("bounds public key lookups without exhausting another source budget", async () => {
  const originalClientId = process.env.EBAY_CLIENT_ID;
  const originalClientSecret = process.env.EBAY_CLIENT_SECRET;
  process.env.EBAY_CLIENT_ID = "synthetic-client";
  process.env.EBAY_CLIENT_SECRET = "synthetic-secret";

  const fetchMock = vi.fn(async () =>
    fetchMock.mock.calls.length === 1
      ? Response.json({ access_token: "synthetic-token", expires_in: 3600 })
      : Response.json({}, { status: 404 }),
  );
  vi.stubGlobal("fetch", fetchMock);

  try {
    for (let index = 0; index <= 20; index += 1) {
      const signatureHeader = Buffer.from(
        JSON.stringify({
          kid: `synthetic-key-${index}`,
          signature: "c3ludGhldGlj",
        }),
      ).toString("base64");

      await assert.rejects(
        verifyEbayNotificationSignature({
          body: Buffer.from("{}"),
          lookupBudgetKey: "abusive-source",
          signatureHeader,
        }),
      );
    }

    assert.equal(fetchMock.mock.calls.length, 21);

    const independentSignatureHeader = Buffer.from(
      JSON.stringify({
        kid: "independent-key",
        signature: "c3ludGhldGlj",
      }),
    ).toString("base64");
    await assert.rejects(
      verifyEbayNotificationSignature({
        body: Buffer.from("{}"),
        lookupBudgetKey: "provider-source",
        signatureHeader: independentSignatureHeader,
      }),
    );
    assert.equal(fetchMock.mock.calls.length, 22);
  } finally {
    vi.unstubAllGlobals();
    restoreEnv("EBAY_CLIENT_ID", originalClientId);
    restoreEnv("EBAY_CLIENT_SECRET", originalClientSecret);
  }
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

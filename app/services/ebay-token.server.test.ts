import assert from "node:assert/strict";
import { EbayConnectionStatus, type EbayConnection } from "@prisma/client";
import { test } from "vitest";

import { EbayTokenError, getUsableEbayAccessToken } from "./ebay-token.server";

test("preserves refresh token decryption errors", async () => {
  const connection = {
    encryptedAccessToken: null,
    encryptedRefreshToken: "synthetic-invalid-envelope",
    id: "synthetic-connection",
    refreshTokenExpiresAt: null,
    scopes: null,
    status: EbayConnectionStatus.CONNECTED,
    tokenExpiresAt: null,
  } as EbayConnection;

  await assert.rejects(
    getUsableEbayAccessToken(connection),
    (error: unknown) =>
      error instanceof Error &&
      !(error instanceof EbayTokenError) &&
      error.message === "Formato segreto cifrato non valido.",
  );
});

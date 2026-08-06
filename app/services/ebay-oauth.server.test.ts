import assert from "node:assert/strict";
import { test, vi } from "vitest";

import { EbayOAuthRequestError, requestEbayOAuthToken } from "./ebay-oauth.server.ts";

test("uses one OAuth adapter for every eBay grant and environment", async () => {
  const originalClientId = process.env.EBAY_CLIENT_ID;
  const originalClientSecret = process.env.EBAY_CLIENT_SECRET;
  process.env.EBAY_CLIENT_ID = "synthetic-client";
  process.env.EBAY_CLIENT_SECRET = "synthetic-secret";
  const requests: Array<{ authorization: string | null; body: URLSearchParams; url: string }> = [];

  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const body = init?.body as URLSearchParams;
    requests.push({
      authorization: new Headers(init?.headers).get("Authorization"),
      body,
      url: String(input),
    });
    if (body.get("refresh_token") === "revoked-refresh") {
      return Response.json(
        { error: "invalid_grant", error_description: "Synthetic revoked token" },
        { status: 401 },
      );
    }
    return Response.json({ access_token: "synthetic-token", expires_in: 7200 });
  });

  try {
    const authorizationToken = await requestEbayOAuthToken({
      environment: "production",
      grant: {
        code: "synthetic-code",
        redirectUri: "synthetic-runame",
        type: "authorization_code",
      },
    });
    await requestEbayOAuthToken({
      environment: "sandbox",
      grant: { refreshToken: "synthetic-refresh", scope: "synthetic-scope", type: "refresh_token" },
    });
    await requestEbayOAuthToken({
      environment: "sandbox",
      grant: { scope: "synthetic-scope", type: "client_credentials" },
    });

    assert.equal(authorizationToken.accessToken, "synthetic-token");
    assert.deepEqual(
      requests.map(({ body }) => body.get("grant_type")),
      ["authorization_code", "refresh_token", "client_credentials"],
    );
    assert.deepEqual(
      requests.map(({ url }) => new URL(url).host),
      ["api.ebay.com", "api.sandbox.ebay.com", "api.sandbox.ebay.com"],
    );
    assert.ok(
      requests.every(
        ({ authorization }) =>
          authorization ===
          `Basic ${Buffer.from("synthetic-client:synthetic-secret").toString("base64")}`,
      ),
    );
    await assert.rejects(
      requestEbayOAuthToken({
        environment: "sandbox",
        grant: { refreshToken: "revoked-refresh", type: "refresh_token" },
      }),
      (error: unknown) =>
        error instanceof EbayOAuthRequestError &&
        error.code === "invalid_grant" &&
        error.status === 401,
    );
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

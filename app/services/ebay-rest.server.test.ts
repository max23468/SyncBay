import assert from "node:assert/strict";
import { test, vi } from "vitest";

import { requestEbayRestJson } from "./ebay-rest.server.ts";

test("centralizes authenticated eBay JSON requests and provider errors", async () => {
  const requests: Array<{ headers: Headers; signal: AbortSignal | null }> = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      headers: new Headers(init?.headers),
      signal: init?.signal ?? null,
    });

    const path = new URL(String(input)).pathname;
    if (path === "/rate-limit") {
      return Response.json(
        { errors: [{ errorId: 2001, longMessage: "Synthetic quota exhausted" }] },
        { status: 429 },
      );
    }
    if (path === "/invalid-json") {
      return new Response("not-json", { status: 502 });
    }
    if (path === "/network-error") {
      throw new Error("synthetic network failure");
    }

    return Response.json({ ok: true });
  });

  try {
    const body = await requestEbayRestJson<{ ok: boolean }>({
      accessToken: "synthetic-token",
      headers: { "Accept-Language": "it-IT" },
      operation: "eBay Inventory API",
      url: new URL("https://api.sandbox.ebay.com/inventory"),
    });
    assert.equal(body.ok, true);
    assert.equal(requests[0]?.headers.get("Authorization"), "Bearer synthetic-token");
    assert.equal(requests[0]?.headers.get("Accept"), "application/json");
    assert.equal(requests[0]?.headers.get("Accept-Language"), "it-IT");
    assert.ok(requests[0]?.signal instanceof AbortSignal);

    await assert.rejects(
      requestEbayRestJson({
        accessToken: "synthetic-token",
        operation: "Analytics API rate limit",
        url: new URL("https://api.ebay.com/rate-limit"),
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.message ===
          "Analytics API rate limit ha risposto con HTTP 429: Synthetic quota exhausted",
    );
    await assert.rejects(
      requestEbayRestJson({
        accessToken: "synthetic-token",
        operation: "Profilo eBay",
        url: new URL("https://apiz.ebay.com/invalid-json"),
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "Profilo eBay: risposta JSON non valida (HTTP 502).",
    );
    await assert.rejects(
      requestEbayRestJson({
        accessToken: "synthetic-token",
        operation: "Public key eBay",
        url: new URL("https://api.ebay.com/network-error"),
      }),
      (error: unknown) =>
        error instanceof Error && error.message === "Public key eBay: errore di rete.",
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

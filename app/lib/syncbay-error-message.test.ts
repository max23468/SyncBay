import assert from "node:assert/strict";
import { test } from "vitest";

import { formatSyncJobErrorMessage } from "./syncbay-error-message.ts";

test("adds a safe nested Undici code to a generic fetch failure", () => {
  const error = new Error("fetch failed") as Error & { cause: unknown };
  error.cause = { code: "UND_ERR_CONNECT_TIMEOUT", host: "provider.example" };

  assert.equal(formatSyncJobErrorMessage(error), "fetch failed (UND_ERR_CONNECT_TIMEOUT)");
});

test("keeps nested provider details out of the persisted message", () => {
  const error = new Error("fetch failed") as Error & { cause: unknown };
  error.cause = {
    code: "token=https://provider.example/private?secret=value",
    message: "Bearer secret-token",
  };

  assert.equal(formatSyncJobErrorMessage(error), "fetch failed");
});

test("collects safe codes across an Error cause chain without duplicating the message", () => {
  const nested = new Error("socket closed") as Error & { code: string };
  nested.code = "ECONNRESET";
  const error = new Error("Request failed with ECONNRESET") as Error & {
    cause: unknown;
    code: string;
  };
  error.code = "UND_ERR_SOCKET";
  error.cause = nested;

  assert.equal(formatSyncJobErrorMessage(error), "Request failed with ECONNRESET (UND_ERR_SOCKET)");
});

test("ignores non-Error values and normalizes whitespace", () => {
  assert.equal(formatSyncJobErrorMessage("fetch failed"), null);
  assert.equal(formatSyncJobErrorMessage(new Error("fetch\n  failed")), "fetch failed");
});

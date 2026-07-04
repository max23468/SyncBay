import assert from "node:assert/strict";
import { test } from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { isTransientWebhookPersistenceError } from "./syncbay-webhook-errors.ts";

test("recognizes database connection timeouts as transient webhook persistence errors", () => {
  assert.equal(
    isTransientWebhookPersistenceError(
      new Error("timeout exceeded when trying to connect"),
    ),
    true,
  );
});

test("recognizes Prisma transaction start timeouts as transient webhook persistence errors", () => {
  assert.equal(
    isTransientWebhookPersistenceError({
      code: "P2028",
      message:
        "Transaction API error: Unable to start a transaction in the given time.",
      name: "PrismaClientKnownRequestError",
    }),
    true,
  );
});

test("recognizes Prisma errors that carry code on an Error instance", () => {
  const error = new Error(
    "Transaction API error: Unable to start a transaction in the given time.",
  ) as Error & { code: string };
  error.code = "P2028";

  assert.equal(isTransientWebhookPersistenceError(error), true);
});

test("recognizes transient session storage readiness failures", () => {
  assert.equal(
    isTransientWebhookPersistenceError(
      new Error("Prisma session storage is not ready"),
    ),
    true,
  );
});

test("does not classify unrelated errors as transient webhook persistence errors", () => {
  assert.equal(
    isTransientWebhookPersistenceError(new Error("invalid webhook payload")),
    false,
  );
});

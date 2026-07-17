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

test("recognizes connection pool checkout timeouts nested in cause as transient", () => {
  const error = new Error(
    "(ECHECKOUTTIMEOUT) unable to check out connection from the pool after 60000ms in Transaction mode",
  ) as Error & { cause: unknown };
  error.cause = {
    code: "XX000",
    kind: "postgres",
    message:
      "(ECHECKOUTTIMEOUT) unable to check out connection from the pool after 60000ms in Transaction mode",
    originalCode: "XX000",
  };

  assert.equal(isTransientWebhookPersistenceError(error), true);
});

test("recognizes driver handler exits as transient webhook persistence errors", () => {
  assert.equal(
    isTransientWebhookPersistenceError(
      new Error(
        "(EDBHANDLEREXITED) DbHandler exited. Check logs for more information",
      ),
    ),
    true,
  );
});

test("recognizes deadlocks reported via error cause as transient", () => {
  const error = new Error("DriverAdapterError") as Error & { cause: unknown };
  error.cause = {
    code: "40P01",
    message: "deadlock detected",
    originalCode: "40P01",
  };

  assert.equal(isTransientWebhookPersistenceError(error), true);
});

test("does not classify unrelated errors as transient webhook persistence errors", () => {
  assert.equal(
    isTransientWebhookPersistenceError(new Error("invalid webhook payload")),
    false,
  );
});

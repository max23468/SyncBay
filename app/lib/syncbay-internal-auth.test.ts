import assert from "node:assert/strict";
import test from "node:test";

import { verifyInternalAppSecret } from "./syncbay-internal-auth.ts";

test("rejects internal requests when APP_SECRET is not configured", () => {
  assert.deepEqual(
    verifyInternalAppSecret({
      authorization: "Bearer test-secret",
      expectedSecret: "",
      headerSecret: null,
    }),
    {
      ok: false,
      status: 503,
      message: "APP_SECRET non configurato.",
    },
  );
});

test("accepts an internal bearer secret without exposing it", () => {
  assert.deepEqual(
    verifyInternalAppSecret({
      authorization: "Bearer test-secret",
      expectedSecret: "test-secret",
      headerSecret: null,
    }),
    { ok: true },
  );
});

test("accepts the internal header secret fallback", () => {
  assert.deepEqual(
    verifyInternalAppSecret({
      authorization: null,
      expectedSecret: "test-secret",
      headerSecret: "test-secret",
    }),
    { ok: true },
  );
});

test("rejects wrong or missing internal secrets with a generic error", () => {
  assert.deepEqual(
    verifyInternalAppSecret({
      authorization: "Bearer wrong",
      expectedSecret: "test-secret",
      headerSecret: null,
    }),
    {
      ok: false,
      status: 401,
      message: "Non autorizzato.",
    },
  );

  assert.deepEqual(
    verifyInternalAppSecret({
      authorization: null,
      expectedSecret: "test-secret",
      headerSecret: null,
    }),
    {
      ok: false,
      status: 401,
      message: "Non autorizzato.",
    },
  );
});

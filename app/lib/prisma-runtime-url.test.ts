import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildPrismaRuntimeDatabaseUrl } from "./prisma-runtime-url.ts";

test("adds a conservative Prisma connection limit for serverless runtime", () => {
  const url = buildPrismaRuntimeDatabaseUrl(
    "postgresql://user:pass@example.com:5432/postgres?sslmode=require",
  );

  assert.equal(
    url,
    "postgresql://user:pass@example.com:5432/postgres?sslmode=require&connection_limit=1&pool_timeout=10",
  );
});

test("preserves explicit Prisma pool parameters", () => {
  const url = buildPrismaRuntimeDatabaseUrl(
    "postgresql://user:pass@example.com/postgres?connection_limit=2&pool_timeout=5",
  );

  assert.equal(
    url,
    "postgresql://user:pass@example.com/postgres?connection_limit=2&pool_timeout=5",
  );
});

test("leaves empty or non-url values untouched", () => {
  assert.equal(buildPrismaRuntimeDatabaseUrl(undefined), undefined);
  assert.equal(buildPrismaRuntimeDatabaseUrl(""), "");
  assert.equal(
    buildPrismaRuntimeDatabaseUrl("postgresql://"),
    "postgresql://",
  );
});

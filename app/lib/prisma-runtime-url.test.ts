import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildPrismaRuntimeDatabaseUrl, buildPrismaRuntimePoolConfig } from "./prisma-runtime-url.ts";

test("adds a conservative Prisma connection limit for serverless runtime", () => {
  const url = buildPrismaRuntimeDatabaseUrl(
    "postgresql://user:pass@example.com:5432/postgres?sslmode=require",
  );

  assert.equal(
    url,
    "postgresql://user:pass@example.com:5432/postgres?sslmode=require&connection_limit=1&pool_timeout=10",
  );
});

test("uses libpq-compatible TLS semantics for Supabase sslmode=require URLs", () => {
  const directUrl = buildPrismaRuntimeDatabaseUrl(
    "postgresql://user:pass@db.mgjcbuokppfnglsftsmi.supabase.co/postgres?sslmode=require",
  );
  const poolerConfig = buildPrismaRuntimePoolConfig(
    "postgresql://user:pass@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require",
  );

  assert.equal(
    directUrl,
    "postgresql://user:pass@db.mgjcbuokppfnglsftsmi.supabase.co/postgres?sslmode=require&uselibpqcompat=true&connection_limit=1&pool_timeout=10",
  );
  assert.deepEqual(poolerConfig, {
    connectionString:
      "postgresql://user:pass@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require&uselibpqcompat=true",
    max: 1,
    connectionTimeoutMillis: 10000,
  });
});

test("does not change non-Supabase sslmode=require TLS semantics unless opted in", () => {
  const config = buildPrismaRuntimePoolConfig(
    "postgresql://user:pass@example.com/postgres?sslmode=require",
  );
  const optInConfig = buildPrismaRuntimePoolConfig(
    "postgresql://user:pass@example.com/postgres?sslmode=require&uselibpqcompat=true",
  );

  assert.deepEqual(config, {
    connectionString: "postgresql://user:pass@example.com/postgres?sslmode=require",
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  assert.deepEqual(optInConfig, {
    connectionString:
      "postgresql://user:pass@example.com/postgres?sslmode=require&uselibpqcompat=true",
    max: 1,
    connectionTimeoutMillis: 10000,
  });
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

test("translates Prisma URL pool parameters to pg adapter pool config", () => {
  const config = buildPrismaRuntimePoolConfig(
    "postgresql://user:pass@example.com/postgres?sslmode=require&connection_limit=2&pool_timeout=5",
  );

  assert.deepEqual(config, {
    connectionString: "postgresql://user:pass@example.com/postgres?sslmode=require",
    max: 2,
    connectionTimeoutMillis: 5000,
  });
});

test("uses conservative pg adapter pool defaults without a database URL", () => {
  assert.deepEqual(buildPrismaRuntimePoolConfig(undefined), {
    connectionString: "postgresql://user:pass@localhost:5432/syncbay",
    max: 1,
    connectionTimeoutMillis: 10000,
  });
});

test("leaves empty or non-url values untouched", () => {
  assert.equal(buildPrismaRuntimeDatabaseUrl(undefined), undefined);
  assert.equal(buildPrismaRuntimeDatabaseUrl(""), "");
  assert.equal(
    buildPrismaRuntimeDatabaseUrl("postgresql://"),
    "postgresql://",
  );
});

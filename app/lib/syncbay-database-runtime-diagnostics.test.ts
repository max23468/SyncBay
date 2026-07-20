import assert from "node:assert/strict";
import { test } from "vitest";

import * as databaseRuntimeDiagnostics from "./syncbay-database-runtime-diagnostics.ts";

const { buildDatabaseRuntimeDiagnostics, classifyDatabaseUrl } = databaseRuntimeDiagnostics;

test("classifies Supabase pooler URLs without exposing the host or credentials", () => {
  assert.deepEqual(
    classifyDatabaseUrl(
      "postgresql://postgres.example:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require&connection_limit=1&pool_timeout=10",
    ),
    {
      present: true,
      parseable: true,
      protocol: "postgresql",
      hostKind: "supabase_pooler",
      port: "6543",
      databasePresent: true,
      hasPassword: true,
      params: ["connection_limit", "pool_timeout", "sslmode"],
      prismaPoolParams: {
        connectionLimit: true,
        poolTimeout: true,
      },
    },
  );
});

test("classifies Supabase direct URLs separately from pooler URLs", () => {
  const diagnostics = classifyDatabaseUrl(
    "postgresql://postgres:secret@db.mgjcbuokppfnglsftsmi.supabase.co:5432/postgres",
  );

  assert.equal(diagnostics.hostKind, "supabase_direct");
  assert.equal(diagnostics.port, "5432");
  assert.equal(diagnostics.prismaPoolParams.connectionLimit, false);
  assert.equal(diagnostics.prismaPoolParams.poolTimeout, false);
});

test("reports Prisma runtime defaults applied to DATABASE_URL", () => {
  const diagnostics = buildDatabaseRuntimeDiagnostics({
    databaseUrl:
      "postgresql://postgres:secret@db.mgjcbuokppfnglsftsmi.supabase.co:5432/postgres?sslmode=require",
    databaseDirectUrl:
      "postgresql://postgres:secret@db.mgjcbuokppfnglsftsmi.supabase.co:5432/postgres",
    prismaRuntimeDatabaseUrl:
      "postgresql://postgres:secret@db.mgjcbuokppfnglsftsmi.supabase.co:5432/postgres?sslmode=require&connection_limit=1&pool_timeout=10",
  });

  assert.deepEqual(diagnostics.runtimeAppliedDefaults, {
    connectionLimit: true,
    poolTimeout: true,
  });
  assert.equal(diagnostics.prismaRuntimeDatabaseUrl.prismaPoolParams.connectionLimit, true);
  assert.equal(diagnostics.prismaRuntimeDatabaseUrl.prismaPoolParams.poolTimeout, true);
});

test("does not treat missing or invalid values as configured URLs", () => {
  assert.equal(classifyDatabaseUrl(undefined).present, false);

  const diagnostics = classifyDatabaseUrl("not-a-url");

  assert.equal(diagnostics.present, true);
  assert.equal(diagnostics.parseable, false);
  assert.equal(diagnostics.hostKind, "unknown");
});

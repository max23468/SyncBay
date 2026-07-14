import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCompatiblePostgresVersions,
  assertNonProductionTarget,
  extractPostgresMajor,
  parseBackupArgs,
} from "./syncbay-db-backup.mjs";

test("backup is dry-run by default and apply requires double confirmation", () => {
  assert.deepEqual(parseBackupArgs([]), { apply: false, restoreCheck: false });
  assert.throws(() => parseBackupArgs(["--apply"]), /insieme/);
  assert.deepEqual(parseBackupArgs(["--apply", "--confirm-apply"]), { apply: true, restoreCheck: false });
});

test("restore check rejects production-like and Supabase targets", () => {
  assert.throws(() => assertNonProductionTarget("postgres://db.supabase.co/prod"), /non-production/);
  assert.doesNotThrow(() => assertNonProductionTarget("postgres://localhost/syncbay_restore_test"));
});

test("PostgreSQL major versions are extracted and must match before restore", () => {
  assert.equal(extractPostgresMajor("pg_dump (PostgreSQL) 17.4"), 17);
  assert.equal(extractPostgresMajor("17.6 (Ubuntu)"), 17);
  assert.equal(extractPostgresMajor("unknown"), null);
  assert.doesNotThrow(() => assertCompatiblePostgresVersions("pg_dump (PostgreSQL) 17.4", "17.6"));
  assert.throws(
    () => assertCompatiblePostgresVersions("pg_dump (PostgreSQL) 16.8", "17.6"),
    /incompatibili/,
  );
});

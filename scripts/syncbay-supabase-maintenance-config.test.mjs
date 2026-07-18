import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "vitest";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("retires the legacy internal maintenance cron in favor of daily app maintenance", () => {
  const migration = fs.readFileSync(
    `${ROOT}prisma/migrations/20260716093000_retire_legacy_internal_maintenance_cron/migration.sql`,
    "utf8",
  );
  const service = fs.readFileSync(
    `${ROOT}app/services/product-history.server.ts`,
    "utf8",
  );

  assert.match(
    migration,
    /cron\.unschedule\('syncbay-maintain-supabase-internal-tables'\)/,
  );
  assert.doesNotMatch(migration, /cron\.schedule\(/);
  assert.match(service, /14 \* 24 \* 60 \* 60 \* 1_000/);
  assert.doesNotMatch(service, /net\._http_response/);
});

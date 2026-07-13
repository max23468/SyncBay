import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  getImportPreviewFixture,
  getUiFixtureStates,
} from "./syncbay-ui-fixtures.ts";
import { buildIsolatedUiEnv } from "./syncbay-ui-isolation.mjs";

const contaminatedEnv = {
  ...process.env,
  DATABASE_URL: "sentinel://must-not-be-used",
  EBAY_CLIENT_SECRET: "sentinel-ebay",
  SHOPIFY_API_SECRET: "sentinel-shopify",
  SUPABASE_SERVICE_ROLE_KEY: "sentinel-supabase",
  TOKEN_ENCRYPTION_KEY: "sentinel-token",
};

for (const page of ["panoramica", "importazione"]) {
  test(`${page} renders without loading or inheriting runtime env`, () => {
    const isolatedEnv = buildIsolatedUiEnv(contaminatedEnv);
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/syncbay-ui-render.mjs",
        page,
        "--fixture",
        "--check",
      ],
      { encoding: "utf8", env: isolatedEnv },
    );
    assert.match(
      result.stderr,
      /env: fixture isolata; 0 variabili runtime caricate/,
    );
    assert.doesNotMatch(
      `${result.stderr}\n${result.stdout}`,
      /EADDRNOTAVAIL|TOKEN_ENCRYPTION_KEY|DATABASE_URL|sentinel-/,
    );
    assert.equal(result.status, 0, result.stderr);
  });
}

test("isolated UI env excludes every provider and database sentinel", () => {
  const isolatedEnv = buildIsolatedUiEnv(contaminatedEnv);

  assert.equal(isolatedEnv.DATABASE_URL, undefined);
  assert.equal(isolatedEnv.EBAY_CLIENT_SECRET, undefined);
  assert.equal(isolatedEnv.SHOPIFY_API_SECRET, undefined);
  assert.equal(isolatedEnv.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(isolatedEnv.TOKEN_ENCRYPTION_KEY, undefined);
  assert.equal(isolatedEnv.SYNCBAY_UI_RENDER_FIXTURE, "1");
});

test("import fixture carries real field policies for every takeover row", () => {
  const report = getImportPreviewFixture().wizard.previewResult
    .existingCatalogTakeover;

  assert.ok(report);
  assert.equal(report.rows.length, 3);
  for (const row of report.rows) {
    assert.ok(row.fieldPolicy.handle);
    assert.ok(row.fieldPolicy.images);
    assert.ok(row.fieldPolicy.tags);
  }
});

test("import exposes blocked and in_progress in addition to common states", () => {
  assert.deepEqual(getUiFixtureStates("catalogo"), [
    "healthy",
    "empty",
    "loading",
    "degraded",
    "error",
  ]);
  assert.deepEqual(getUiFixtureStates("importazione"), [
    "healthy",
    "empty",
    "loading",
    "degraded",
    "error",
    "blocked",
    "in_progress",
  ]);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

for (const page of ["panoramica", "importazione"]) {
  test(`${page} renders without loading runtime env`, () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/syncbay-ui-render.mjs", page, "--fixture", "--check"],
      { encoding: "utf8", env: { ...process.env, DATABASE_URL: "sentinel://must-not-be-used" } },
    );
    assert.match(result.stderr, /env: fixture isolata; 0 variabili runtime caricate/);
    assert.doesNotMatch(result.stderr, /EADDRNOTAVAIL|TOKEN_ENCRYPTION_KEY|DATABASE_URL/);
    assert.equal(result.status, 0, result.stderr);
  });
}

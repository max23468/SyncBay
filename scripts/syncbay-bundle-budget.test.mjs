import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { test } from "vitest";
import { measureBundleBudget } from "./syncbay-bundle-budget.mjs";

test("bundle budget fails when build artifacts are missing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "syncbay-bundle-missing-"));
  assert.throws(() => measureBundleBudget(root), /Artefatti build mancanti/);
  const result = spawnSync(process.execPath, [
    "scripts/syncbay-bundle-budget.mjs",
    `--root=${root}`,
  ]);
  assert.notEqual(result.status, 0);
  fs.rmSync(root, { recursive: true });
});

test("bundle budget accepts small files and reports exceeded limits", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "syncbay-bundle-"));
  fs.mkdirSync(path.join(root, "build/client/assets"), { recursive: true });
  fs.mkdirSync(path.join(root, "build/server"), { recursive: true });
  fs.writeFileSync(path.join(root, "build/client/assets/app.catalog.js"), "small");
  fs.writeFileSync(path.join(root, "build/client/assets/syncbay-embedded.css"), "small");
  fs.writeFileSync(path.join(root, "build/server/index.js"), "small");
  assert.equal(measureBundleBudget(root).exceeded.length, 0);
  assert.deepEqual(
    measureBundleBudget(root, { clientTotal: 1, route: 1, css: 1, server: 1 })
      .exceeded.map(([key]) => key)
      .sort(),
    ["clientTotal", "css", "route", "server"],
  );
  const accepted = spawnSync(process.execPath, [
    "scripts/syncbay-bundle-budget.mjs",
    `--root=${root}`,
  ]);
  assert.equal(accepted.status, 0);
  fs.writeFileSync(path.join(root, "build/client/assets/app.catalog.js"), randomBytes(250 * 1024));
  const rejected = spawnSync(process.execPath, [
    "scripts/syncbay-bundle-budget.mjs",
    `--root=${root}`,
  ]);
  assert.equal(rejected.status, 2);
  fs.rmSync(root, { recursive: true });
});

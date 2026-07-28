import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { fileURLToPath } from "node:url";

import { findTopLevelLockMismatches, inspectPrismaClient } from "./syncbay-local-doctor.mjs";

const SCRIPT_PATH = fileURLToPath(new URL("./syncbay-local-doctor.mjs", import.meta.url));

test("finds missing or stale top-level packages against the root lockfile", () => {
  const rootLock = {
    packages: {
      "": {
        dependencies: { alpha: "^1.0.0" },
        devDependencies: { beta: "^2.0.0" },
      },
      "node_modules/alpha": { version: "1.4.0" },
      "node_modules/beta": { version: "2.1.0" },
    },
  };
  const installedLock = {
    packages: {
      "node_modules/alpha": { version: "1.4.0" },
      "node_modules/beta": { version: "2.0.0" },
    },
  };

  assert.deepEqual(findTopLevelLockMismatches(rootLock, installedLock), [
    "beta (installato 2.0.0, atteso 2.1.0)",
  ]);
  assert.deepEqual(findTopLevelLockMismatches(rootLock, { packages: {} }), [
    "alpha (non installato, atteso 1.4.0)",
    "beta (non installato, atteso 2.1.0)",
  ]);
});

test("recognizes generated and correctly linked Prisma Client", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "syncbay-doctor-"));
  const generatedDirectory = path.join(root, "prisma/generated/client");
  const linkDirectory = path.join(root, "node_modules/.prisma/client");
  fs.mkdirSync(generatedDirectory, { recursive: true });
  fs.mkdirSync(linkDirectory, { recursive: true });
  fs.writeFileSync(path.join(generatedDirectory, "index.js"), "export {};\n");
  fs.symlinkSync("../../../prisma/generated/client", path.join(linkDirectory, "default"));

  assert.deepEqual(inspectPrismaClient(root), {
    generated: true,
    linked: true,
  });
});

test("reports missing worktree dependencies with exact repair commands", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "syncbay-doctor-cli-"));
  const npmVersion = execFileSync("npm", ["--version"], {
    encoding: "utf8",
  }).trim();
  fs.mkdirSync(path.join(root, "prisma"));
  fs.writeFileSync(path.join(root, ".node-version"), `${process.versions.node}\n`);
  fs.writeFileSync(path.join(root, ".npmrc"), "engine-strict=true\n");
  fs.writeFileSync(path.join(root, "prisma/schema.prisma"), "generator client {}\n");
  fs.writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify(
      {
        engines: {
          node: ">=24.15 <25",
          npm: ">=12 <13",
        },
        packageManager: `npm@${npmVersion}`,
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(root, "package-lock.json"),
    `${JSON.stringify({ lockfileVersion: 3, packages: { "": {} } })}\n`,
  );

  const result = spawnSync(process.execPath, [SCRIPT_PATH, "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  const report = JSON.parse(result.stdout);

  assert.notEqual(result.status, 0);
  assert.ok(report.failures.some((failure) => failure.includes("npm install")));
  assert.ok(report.failures.some((failure) => failure.includes("npm run prisma:generate")));
  assert.equal(report.checks.dependenciesInstalled, false);
  assert.equal(report.checks.prismaClientGenerated, false);
});

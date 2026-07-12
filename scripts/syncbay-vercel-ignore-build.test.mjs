import assert from "node:assert/strict";
import test from "node:test";

import { shouldBuildVercel } from "./syncbay-vercel-ignore-build.mjs";

test("builds when deployable runtime surfaces change", () => {
  for (const path of [
    "app/routes/app._index.tsx",
    "prisma/schema.prisma",
    "public/favicon.ico",
    "patches/@react-router+dev.patch",
    "package.json",
    "package-lock.json",
    "react-router.config.ts",
    "vite.config.ts",
    "prisma.config.ts",
    "tsconfig.json",
    ".node-version",
    "vercel.json",
    "scripts/link-prisma-client.mjs",
  ]) {
    assert.equal(shouldBuildVercel([path]), true, path);
  }
});

test("skips changes limited to documentation governance CI and non-runtime tooling", () => {
  assert.equal(
    shouldBuildVercel([
      ".github/workflows/ci.yml",
      "AGENTS.md",
      "CHANGELOG.md",
      "README.md",
      "docs/TOOLCHAIN.md",
      "scripts/syncbay-verify.mjs",
      "scripts/syncbay-worktree.test.mjs",
      "supabase/config.toml",
    ]),
    false,
  );
});

test("skips application tests but builds unknown files conservatively", () => {
  assert.equal(shouldBuildVercel(["app/lib/example.test.ts"]), false);
  assert.equal(shouldBuildVercel(["new-runtime.config.mjs"]), true);
});

test("builds when no reliable diff is available", () => {
  assert.equal(shouldBuildVercel([]), true);
});

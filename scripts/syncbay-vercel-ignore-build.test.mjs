import assert from "node:assert/strict";
import { test } from "vitest";

import { shouldBuildVercel, shouldSkipDependabotPreview } from "./syncbay-vercel-ignore-build.mjs";

test("builds when deployable runtime surfaces change", () => {
  for (const path of [
    "app/routes/app._index.tsx",
    "prisma/schema.prisma",
    "public/favicon.ico",
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
  assert.equal(shouldBuildVercel(["app/services/AGENTS.md"]), false);
  assert.equal(shouldBuildVercel(["new-runtime.config.mjs"]), true);
});

test("builds when no reliable diff is available", () => {
  assert.equal(shouldBuildVercel([]), true);
});

test("skips only Dependabot preview branches", () => {
  for (const ref of [
    "dependabot/npm_and_yarn/vitest-5.0.3",
    "dependabot/npm_and_yarn/shopify/shopify-app-react-router-3.0.1",
  ]) {
    assert.equal(
      shouldSkipDependabotPreview({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: ref }),
      true,
    );
  }
});

test("keeps production and other previews under the existing build policy", () => {
  for (const env of [
    { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "dependabot/example" },
    { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" },
    { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "fix/dependabot-example" },
    { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature/catalog" },
    { VERCEL_ENV: "development", VERCEL_GIT_COMMIT_REF: "dependabot/example" },
    { VERCEL_GIT_COMMIT_REF: "dependabot/example" },
    { VERCEL_ENV: "preview" },
    {},
  ]) {
    assert.equal(shouldSkipDependabotPreview(env), false);
  }
});

#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const NON_DEPLOY_PREFIXES = [".github/", ".mex/", "docs/", "preview/", "supabase/"];

const NON_DEPLOY_ROOT_FILES = new Set([
  ".env.example",
  "AGENTS.md",
  "BRAND.md",
  "CHANGELOG.md",
  "CLAUDE.md",
  "README.md",
  "SECURITY.md",
  "doctor.config.json",
  ".oxlintrc.json",
  "shopify.app.toml",
  "shopify.web.toml",
]);

const DEPLOY_SCRIPTS = new Set(["scripts/link-prisma-client.mjs"]);

export function shouldBuildVercel(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return true;
  return paths.some(isDeployRelevantPath);
}

export function isDeployRelevantPath(path) {
  if (typeof path !== "string" || path.length === 0) return true;
  if (/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path)) return false;
  if (DEPLOY_SCRIPTS.has(path)) return true;
  if (path.startsWith("scripts/")) return false;
  if (NON_DEPLOY_ROOT_FILES.has(path)) return false;
  if (NON_DEPLOY_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  return true;
}

if (import.meta.main) {
  const base = process.env.VERCEL_GIT_PREVIOUS_SHA || "HEAD^";
  const diff = spawnSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACDMRTUXB", base, "HEAD", "--"],
    { encoding: "utf8" },
  );

  if (diff.status !== 0) {
    console.log(
      `Vercel build richiesto: diff non disponibile da ${base}; applico il fallback conservativo.`,
    );
    process.exit(1);
  }

  const paths = diff.stdout
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean);
  const deployRelevant = paths.filter(isDeployRelevantPath);

  if (shouldBuildVercel(paths)) {
    console.log(
      `Vercel build richiesto: ${deployRelevant.join(", ") || "diff vuoto o non classificabile"}.`,
    );
    process.exit(1);
  }

  console.log(`Vercel build saltato: ${paths.join(", ")} non modifica il runtime distribuito.`);
}

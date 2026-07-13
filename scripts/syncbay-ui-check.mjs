#!/usr/bin/env node

import { spawnSync } from "node:child_process";

export const UI_PAGES = [
  "panoramica",
  "catalogo",
  "conflitti",
  "importazione",
  "attivita",
  "impostazioni",
];

if (process.argv[1]?.endsWith("syncbay-ui-check.mjs")) {
  for (const page of UI_PAGES) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/syncbay-ui-render.mjs", page, "--fixture", "--check"],
      { encoding: "utf8", env: { ...process.env, SYNCBAY_UI_CHECK_SENTINEL: "isolated" } },
    );
    process.stderr.write(result.stderr);
    if (result.status !== 0) {
      process.stderr.write(result.stdout);
      process.exit(result.status ?? 1);
    }
  }
  console.log(`UI SSR verificate: ${UI_PAGES.length}`);
}

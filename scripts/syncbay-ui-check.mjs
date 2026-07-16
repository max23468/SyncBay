#!/usr/bin/env node

import { spawnSync } from "node:child_process";

import {
  getUiFixture,
  getUiFixtureStates,
} from "./syncbay-ui-fixtures.ts";
import { buildIsolatedUiEnv } from "./syncbay-ui-isolation.mjs";
import { assertSyncBayLoaderPayloadBudget } from "../app/lib/syncbay-loader-performance.ts";

export const UI_PAGES = [
  "panoramica",
  "catalogo",
  "conflitti",
  "importazione",
  "attivita",
  "impostazioni",
];
export const UI_STATES = ["healthy", "empty", "loading", "degraded", "error"];
const LOADER_ROUTE_BY_PAGE = {
  attivita: "activity",
  catalogo: "catalog",
  conflitti: "conflicts",
  importazione: "import",
  impostazioni: "settings",
  panoramica: "overview",
};

export function runUiCheck() {
  let scenarioCount = 0;
  for (const page of UI_PAGES) {
    assertSyncBayLoaderPayloadBudget(
      LOADER_ROUTE_BY_PAGE[page],
      getUiFixture(page, "healthy"),
    );
    for (const state of getUiFixtureStates(page)) {
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/syncbay-ui-render.mjs",
          page,
          "--fixture",
          "--check",
          `--state=${state}`,
        ],
        {
          encoding: "utf8",
          env: buildIsolatedUiEnv(),
        },
      );
      process.stderr.write(result.stderr);
      if (result.status !== 0) {
        process.stderr.write(result.stdout);
        return result.status ?? 1;
      }
      scenarioCount += 1;
    }
  }
  console.log(
    `UI SSR verificate: ${UI_PAGES.length} pagine, ${scenarioCount} scenari isolati`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(runUiCheck());
}

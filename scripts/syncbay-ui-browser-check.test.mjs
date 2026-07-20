import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import { UI_PAGES } from "./syncbay-ui-check.mjs";
import { UI_BROWSER_SCENARIOS, UI_BROWSER_VIEWPORTS } from "./syncbay-ui-browser-check.mjs";

test("the browser gate covers every embedded surface", () => {
  assert.deepEqual(UI_PAGES, [
    "panoramica",
    "catalogo",
    "conflitti",
    "importazione",
    "attivita",
    "impostazioni",
  ]);
});

test("the browser gate covers desktop tablet and mobile widths", () => {
  assert.deepEqual(
    UI_BROWSER_VIEWPORTS.map(({ width }) => width),
    [1440, 1024, 768, 390],
  );
});

test("the browser gate includes failure and import lifecycle scenarios", () => {
  assert.deepEqual(UI_BROWSER_SCENARIOS, [
    { page: "panoramica", state: "empty" },
    { page: "panoramica", state: "loading" },
    { page: "panoramica", state: "degraded" },
    { page: "panoramica", state: "error" },
    { page: "importazione", state: "blocked" },
    { page: "importazione", state: "in_progress" },
  ]);
});

test("the browser gate verifies focus restoration after navigation and submit", () => {
  const source = readFileSync(new URL("./syncbay-ui-browser-check.mjs", import.meta.url), "utf8");

  assert.match(source, /verifyNavigationFocus/);
  assert.match(source, /verifySubmissionFocus/);
  assert.match(source, /Salva intervallo/);
});

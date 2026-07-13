import assert from "node:assert/strict";
import test from "node:test";

import { UI_PAGES } from "./syncbay-ui-check.mjs";

test("the browser gate covers every embedded surface", () => {
  assert.deepEqual(UI_PAGES, ["panoramica", "catalogo", "conflitti", "importazione", "attivita", "impostazioni"]);
});

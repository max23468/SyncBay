import assert from "node:assert/strict";
import { test } from "vitest";

import { normalizeImportPreviewLoadMode } from "./syncbay-import-preview-mode.ts";

test("defaults import preview loading to deferred", () => {
  assert.equal(normalizeImportPreviewLoadMode(null), "deferred");
  assert.equal(normalizeImportPreviewLoadMode(""), "deferred");
  assert.equal(normalizeImportPreviewLoadMode("mock"), "deferred");
});

test("accepts explicit live preview loading", () => {
  assert.equal(normalizeImportPreviewLoadMode("live"), "live");
});

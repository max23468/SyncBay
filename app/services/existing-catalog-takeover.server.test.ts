import assert from "node:assert/strict";
import test from "node:test";

import {
  getExistingCatalogTakeoverPreview,
  startExistingCatalogTakeoverJobs,
} from "./existing-catalog-takeover.server";

test("exposes the existing catalog preview and start vertical from one module", () => {
  assert.equal(typeof getExistingCatalogTakeoverPreview, "function");
  assert.equal(typeof startExistingCatalogTakeoverJobs, "function");
});

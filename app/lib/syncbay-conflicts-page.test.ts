import assert from "node:assert/strict";
import { test } from "vitest";

import * as conflictsPage from "./syncbay-conflicts-page.ts";

const { CONFLICT_PAGE_SIZE, getConflictStatusFilter, normalizeConflictFilter } =
  conflictsPage;

test("normalizes conflict filters", () => {
  assert.equal(normalizeConflictFilter("resolved"), "resolved");
  assert.equal(normalizeConflictFilter("all"), "all");
  assert.equal(normalizeConflictFilter("unknown"), "open");
  assert.equal(normalizeConflictFilter(null), "open");
});

test("uses a compact conflict page size", () => {
  assert.equal(CONFLICT_PAGE_SIZE, 25);
});

test("maps conflict filters to status lists", () => {
  assert.deepEqual(getConflictStatusFilter("open"), ["OPEN"]);
  assert.deepEqual(getConflictStatusFilter("resolved"), [
    "RESOLVED",
    "IGNORED",
  ]);
  assert.deepEqual(getConflictStatusFilter("all"), [
    "OPEN",
    "RESOLVED",
    "IGNORED",
  ]);
});

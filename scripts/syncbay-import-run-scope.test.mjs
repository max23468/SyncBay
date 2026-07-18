import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildImportRunScopeSql,
  getImportRunScopeId,
} from "./syncbay-import-run-scope.mjs";

test("falls back to import job id when catalogImportRunId is null", () => {
  assert.equal(
    getImportRunScopeId({
      id: "job-123",
      payload: { catalogImportRunId: null },
    }),
    "job-123",
  );
});

test("uses non-empty catalogImportRunId when present", () => {
  assert.equal(
    getImportRunScopeId({
      id: "job-123",
      payload: { catalogImportRunId: "run-456" },
    }),
    "run-456",
  );
});

test("builds SQL scope expression with null and empty-string fallback", () => {
  assert.equal(
    buildImportRunScopeSql("j"),
    "coalesce(nullif(j.payload->>'catalogImportRunId', ''), j.id)",
  );
});

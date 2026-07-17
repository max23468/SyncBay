import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as catalogHealthCenter from "./syncbay-catalog-health-center.ts";

const { buildCatalogHealthCenter, getCatalogHealthCenterSummary } =
  catalogHealthCenter;

test("breaks catalog health into concrete operational causes", () => {
  const health = buildCatalogHealthCenter({
    activeIncrementalJobCount: 2,
    erroredMappingCount: 5,
    failedJobCount: 1,
    needsCheckCount: 12,
    openConflictCount: 3,
    staleActiveCount: 8,
    unknownAvailabilityCount: 4,
  });

  assert.deepEqual(
    health.causes.map((cause) => [cause.code, cause.count, cause.tone]),
    [
      ["stale_sync", 8, "warning"],
      ["needs_check", 12, "warning"],
      ["unknown_availability", 4, "warning"],
      ["open_conflicts", 3, "warning"],
      ["errored_mappings", 5, "critical"],
      ["failed_jobs", 1, "critical"],
      ["incremental_running", 2, "info"],
    ],
  );
  assert.equal(health.status, "critical");
});

test("summarizes healthy catalog state", () => {
  const health = buildCatalogHealthCenter({
    activeIncrementalJobCount: 0,
    erroredMappingCount: 0,
    failedJobCount: 0,
    needsCheckCount: 0,
    openConflictCount: 0,
    staleActiveCount: 0,
    unknownAvailabilityCount: 0,
  });

  assert.equal(health.status, "success");
  assert.equal(getCatalogHealthCenterSummary(health), "Catalogo allineato");
});

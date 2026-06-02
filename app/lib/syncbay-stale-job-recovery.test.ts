import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { getRecoverableRunningSyncJobTypes, isStaleRunningSyncJob } from "./syncbay-stale-job-recovery.ts";

const runnableTypes = [
  "UPDATE_EBAY_STOCK",
  "SYNC_INCREMENTAL",
  "ARCHIVE_INACTIVE_LISTING",
  "DETECT_SHOPIFY_CHANGES",
  "IMPORT_CATALOG",
];
const now = new Date("2026-06-02T21:30:00.000Z");
const staleAfterMs = 15 * 60 * 1000;

test("recovers stale running incremental sync jobs", () => {
  assert.equal(
    isStaleRunningSyncJob({
      now,
      runnableTypes,
      staleAfterMs,
      startedAt: new Date("2026-06-02T21:14:59.000Z"),
      status: "RUNNING",
      type: "SYNC_INCREMENTAL",
    }),
    true,
  );
});

test("treats every runnable job type as recoverable", () => {
  assert.deepEqual(getRecoverableRunningSyncJobTypes(runnableTypes), [
    "UPDATE_EBAY_STOCK",
    "SYNC_INCREMENTAL",
    "ARCHIVE_INACTIVE_LISTING",
    "DETECT_SHOPIFY_CHANGES",
    "IMPORT_CATALOG",
  ]);
});

test("keeps fresh running jobs untouched", () => {
  assert.equal(
    isStaleRunningSyncJob({
      now,
      runnableTypes,
      staleAfterMs,
      startedAt: new Date("2026-06-02T21:20:00.000Z"),
      status: "RUNNING",
      type: "SYNC_INCREMENTAL",
    }),
    false,
  );
});

test("ignores non-runnable or non-running jobs", () => {
  assert.equal(
    isStaleRunningSyncJob({
      now,
      runnableTypes,
      staleAfterMs,
      startedAt: new Date("2026-06-02T21:14:00.000Z"),
      status: "SUCCEEDED",
      type: "SYNC_INCREMENTAL",
    }),
    false,
  );
  assert.equal(
    isStaleRunningSyncJob({
      now,
      runnableTypes,
      staleAfterMs,
      startedAt: new Date("2026-06-02T21:14:00.000Z"),
      status: "RUNNING",
      type: "RECONCILE_CATALOG",
    }),
    false,
  );
});

test("ignores running jobs when the stale threshold is invalid", () => {
  assert.equal(
    isStaleRunningSyncJob({
      now,
      runnableTypes,
      staleAfterMs: 0,
      startedAt: null,
      status: "RUNNING",
      type: "SYNC_INCREMENTAL",
    }),
    false,
  );
});

import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildRunnerLanePlan,
  shouldClaimRunnerJob,
  shouldPrioritizeNonReconcileIncrementalJob,
} from "./syncbay-runner-fairness.ts";

const emptyDue = {
  UPDATE_EBAY_STOCK: 0,
  SYNC_INCREMENTAL: 0,
  ARCHIVE_INACTIVE_LISTING: 0,
  DETECT_SHOPIFY_CHANGES: 0,
  IMPORT_CATALOG: 0,
  RECONCILE_CATALOG: 0,
  CLEANUP_STAGING: 0,
};

test("reserves stock and conflict detection when limit is two", () => {
  assert.deepEqual(
    buildRunnerLanePlan({
      dueByType: {
        ...emptyDue,
        UPDATE_EBAY_STOCK: 2,
        SYNC_INCREMENTAL: 50,
        DETECT_SHOPIFY_CHANGES: 547,
        IMPORT_CATALOG: 3,
      },
      limit: 2,
    }),
    ["UPDATE_EBAY_STOCK", "DETECT_SHOPIFY_CHANGES"],
  );
});

test("uses the remaining lane for regular sync when stock is absent", () => {
  assert.deepEqual(
    buildRunnerLanePlan({
      dueByType: {
        ...emptyDue,
        SYNC_INCREMENTAL: 5,
        DETECT_SHOPIFY_CHANGES: 20,
      },
      limit: 2,
    }),
    ["DETECT_SHOPIFY_CHANGES", "SYNC_INCREMENTAL"],
  );
});

test("reserves one slot for reconcile and keeps the others for live deltas", () => {
  const pending = ["reconcile"];
  const selected = Array.from({ length: 5 }, (_, selectedIncrementalJobs) => {
    pending.push(`delta-${selectedIncrementalJobs}`);
    const deltaIndex = shouldPrioritizeNonReconcileIncrementalJob(selectedIncrementalJobs)
      ? pending.findIndex((job) => job.startsWith("delta-"))
      : -1;

    return pending.splice(deltaIndex >= 0 ? deltaIndex : 0, 1)[0];
  });

  assert.deepEqual(selected, ["delta-0", "reconcile", "delta-1", "delta-2", "delta-3"]);
});

test("does not claim another job after the request deadline", () => {
  const deadlineAt = new Date("2026-07-11T10:01:10.000Z");

  assert.equal(
    shouldClaimRunnerJob({
      deadlineAt,
      now: new Date("2026-07-11T10:01:04.999Z"),
    }),
    true,
  );
  assert.equal(
    shouldClaimRunnerJob({
      deadlineAt,
      now: new Date("2026-07-11T10:01:05.000Z"),
    }),
    false,
  );
});

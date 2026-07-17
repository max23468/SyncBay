import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRunnerLanePlan,
  shouldClaimRunnerJob,
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

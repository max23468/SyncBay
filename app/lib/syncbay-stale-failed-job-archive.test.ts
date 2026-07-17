import assert from "node:assert/strict";
import test from "node:test";

import { isSupersededFailedIncrementalSyncJob } from "./syncbay-stale-failed-job-archive.ts";

const now = new Date("2026-06-12T12:00:00.000Z");
const latestSuccessfulIncrementalSyncAt = "2026-06-12T09:30:00.000Z";

test("archives old failed incremental jobs superseded by a later successful sync", () => {
  assert.equal(
    isSupersededFailedIncrementalSyncJob({
      errorCode: "SYNCBAY_INCREMENTAL_BLOCKED",
      latestSuccessfulIncrementalSyncAt,
      now,
      status: "FAILED",
      type: "SYNC_INCREMENTAL",
      updatedAt: "2026-06-08T10:17:01.030Z",
    }),
    true,
  );
});

test("ages stale failures against now instead of the later success timestamp", () => {
  assert.equal(
    isSupersededFailedIncrementalSyncJob({
      errorCode: "SYNCBAY_INCREMENTAL_BLOCKED",
      latestSuccessfulIncrementalSyncAt: "2026-06-11T09:05:00.000Z",
      now,
      status: "FAILED",
      type: "SYNC_INCREMENTAL",
      updatedAt: "2026-06-11T09:00:00.000Z",
    }),
    true,
  );
});

test("keeps recent failed incremental jobs actionable", () => {
  assert.equal(
    isSupersededFailedIncrementalSyncJob({
      errorCode: "SYNCBAY_INCREMENTAL_BLOCKED",
      latestSuccessfulIncrementalSyncAt,
      now,
      status: "FAILED",
      type: "SYNC_INCREMENTAL",
      updatedAt: "2026-06-11T18:00:00.000Z",
    }),
    false,
  );
});

test("keeps failed jobs that are not superseded by a later success", () => {
  assert.equal(
    isSupersededFailedIncrementalSyncJob({
      errorCode: "SYNCBAY_INCREMENTAL_BLOCKED",
      latestSuccessfulIncrementalSyncAt: "2026-06-08T10:00:00.000Z",
      now,
      status: "FAILED",
      type: "SYNC_INCREMENTAL",
      updatedAt: "2026-06-08T10:17:01.030Z",
    }),
    false,
  );
});

test("keeps unknown failures and non-incremental jobs out of archival", () => {
  assert.equal(
    isSupersededFailedIncrementalSyncJob({
      errorCode: "SHOPIFY_WRITE_FAILED",
      latestSuccessfulIncrementalSyncAt,
      now,
      status: "FAILED",
      type: "SYNC_INCREMENTAL",
      updatedAt: "2026-06-08T10:17:01.030Z",
    }),
    false,
  );
  assert.equal(
    isSupersededFailedIncrementalSyncJob({
      errorCode: "SYNCBAY_INCREMENTAL_BLOCKED",
      latestSuccessfulIncrementalSyncAt,
      now,
      status: "FAILED",
      type: "UPDATE_EBAY_STOCK",
      updatedAt: "2026-06-08T10:17:01.030Z",
    }),
    false,
  );
});

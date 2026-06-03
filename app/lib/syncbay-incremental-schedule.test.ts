import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { getNextIncrementalEnqueueAt } from "./syncbay-incremental-schedule.ts";

const now = new Date("2026-06-03T12:00:00.000Z");

test("uses the sync target after the latest incremental job timestamp", () => {
  assert.deepEqual(
    getNextIncrementalEnqueueAt({
      latestJob: {
        createdAt: new Date("2026-06-03T11:50:00.000Z"),
        finishedAt: new Date("2026-06-03T11:57:00.000Z"),
        runAfter: new Date("2026-06-03T11:50:00.000Z"),
      },
      now,
      syncTargetSeconds: 300,
    }),
    new Date("2026-06-03T12:02:00.000Z"),
  );
});

test("honors a future runAfter marker from eBay rate-limit backoff", () => {
  assert.deepEqual(
    getNextIncrementalEnqueueAt({
      latestJob: {
        createdAt: new Date("2026-06-03T11:58:00.000Z"),
        finishedAt: new Date("2026-06-03T11:58:00.000Z"),
        runAfter: new Date("2026-06-03T12:58:00.000Z"),
      },
      now,
      syncTargetSeconds: 300,
    }),
    new Date("2026-06-03T12:58:00.000Z"),
  );
});

test("schedules immediately when no incremental job exists", () => {
  assert.deepEqual(
    getNextIncrementalEnqueueAt({
      latestJob: null,
      now,
      syncTargetSeconds: 300,
    }),
    now,
  );
});

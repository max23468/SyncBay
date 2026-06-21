import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as incrementalSchedule from "./syncbay-incremental-schedule.ts";

const { getNextIncrementalEnqueueAt, shouldEnqueueIncrementalSyncNow } =
  incrementalSchedule;
const { isIncrementalProviderBackoffGate } = incrementalSchedule;

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

test("treats an incremental sync due before the next runner tick as enqueueable", () => {
  const nextRunAfter = getNextIncrementalEnqueueAt({
    latestJob: {
      createdAt: new Date("2026-06-03T11:50:01.000Z"),
      finishedAt: new Date("2026-06-03T11:55:01.000Z"),
      runAfter: new Date("2026-06-03T11:50:01.000Z"),
    },
    now,
    syncTargetSeconds: 300,
  });

  assert.equal(
    shouldEnqueueIncrementalSyncNow({
      nextRunAfter,
      now,
      runnerLookaheadSeconds: 120,
    }),
    true,
  );
});

test("keeps future incremental syncs outside the runner lookahead pending", () => {
  assert.equal(
    shouldEnqueueIncrementalSyncNow({
      nextRunAfter: new Date("2026-06-03T12:02:01.000Z"),
      now,
      runnerLookaheadSeconds: 120,
    }),
    false,
  );
});

test("does not bypass eBay cooldowns inside the runner lookahead", () => {
  const latestJob = {
    createdAt: new Date("2026-06-03T11:58:00.000Z"),
    finishedAt: new Date("2026-06-03T11:58:00.000Z"),
    runAfter: new Date("2026-06-03T12:01:00.000Z"),
  };
  const syncTargetSeconds = 120;
  const nextRunAfter = getNextIncrementalEnqueueAt({
    latestJob,
    now,
    syncTargetSeconds,
  });

  assert.equal(
    isIncrementalProviderBackoffGate({
      latestJob,
      syncTargetSeconds,
    }),
    true,
  );
  assert.equal(
    shouldEnqueueIncrementalSyncNow({
      allowLookahead: !isIncrementalProviderBackoffGate({
        latestJob,
        syncTargetSeconds,
      }),
      nextRunAfter,
      now,
      runnerLookaheadSeconds: 120,
    }),
    false,
  );
});

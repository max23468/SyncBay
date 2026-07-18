import assert from "node:assert/strict";
import { test } from "vitest";

import * as incrementalSchedule from "./syncbay-incremental-schedule.ts";

const { getNextIncrementalEnqueueAt, shouldEnqueueIncrementalSyncNow } =
  incrementalSchedule;

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

test("keeps a selected future sync interval pending", () => {
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
    }),
    false,
  );
});

test("keeps future incremental syncs pending", () => {
  assert.equal(
    shouldEnqueueIncrementalSyncNow({
      nextRunAfter: new Date("2026-06-03T12:05:01.000Z"),
      now,
    }),
    false,
  );
});

test("keeps eBay cooldown runAfter pending", () => {
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
    shouldEnqueueIncrementalSyncNow({
      nextRunAfter,
      now,
    }),
    false,
  );
});

test("treats shorter provider cooldowns as future gates", () => {
  const latestJob = {
    createdAt: new Date("2026-06-03T07:00:00.000Z"),
    finishedAt: new Date("2026-06-03T07:01:00.000Z"),
    runAfter: new Date("2026-06-03T07:05:00.000Z"),
  };
  const nowInsideCooldown = new Date("2026-06-03T07:04:00.000Z");
  const syncTargetSeconds = 300;
  const nextRunAfter = getNextIncrementalEnqueueAt({
    latestJob,
    now: nowInsideCooldown,
    syncTargetSeconds,
  });

  assert.equal(nextRunAfter.toISOString(), "2026-06-03T07:06:00.000Z");
  assert.equal(
    shouldEnqueueIncrementalSyncNow({
      nextRunAfter,
      now: nowInsideCooldown,
    }),
    false,
  );
});

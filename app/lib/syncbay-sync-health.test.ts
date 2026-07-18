import assert from "node:assert/strict";
import { test } from "vitest";

import { getCatalogSyncHealth } from "./syncbay-sync-health.ts";

const now = new Date("2026-06-02T18:00:00.000Z");

test("reports disabled sync without freshness deadlines", () => {
  assert.deepEqual(
    getCatalogSyncHealth({
      activeIncrementalJobCount: 0,
      latestIncrementalFinishedAt: null,
      now,
      syncEnabled: false,
      syncTargetSeconds: 300,
    }),
    {
      nextDueAt: null,
      overdueAt: null,
      secondsUntilDue: null,
      status: "disabled",
    },
  );
});

test("reports running sync work as in progress", () => {
  assert.deepEqual(
    getCatalogSyncHealth({
      activeIncrementalJobCount: 1,
      latestIncrementalFinishedAt: new Date("2026-06-02T17:50:00.000Z"),
      now,
      syncEnabled: true,
      syncTargetSeconds: 300,
    }),
    {
      nextDueAt: new Date("2026-06-02T17:55:00.000Z"),
      overdueAt: new Date("2026-06-02T18:00:01.000Z"),
      secondsUntilDue: -300,
      status: "running",
    },
  );
});

test("reports fresh sync before the next target window", () => {
  assert.deepEqual(
    getCatalogSyncHealth({
      activeIncrementalJobCount: 0,
      latestIncrementalFinishedAt: new Date("2026-06-02T17:57:00.000Z"),
      now,
      syncEnabled: true,
      syncTargetSeconds: 300,
    }),
    {
      nextDueAt: new Date("2026-06-02T18:02:00.000Z"),
      overdueAt: new Date("2026-06-02T18:07:01.000Z"),
      secondsUntilDue: 120,
      status: "fresh",
    },
  );
});

test("reports overdue sync after the target window", () => {
  assert.deepEqual(
    getCatalogSyncHealth({
      activeIncrementalJobCount: 0,
      latestIncrementalFinishedAt: new Date("2026-06-02T17:44:59.000Z"),
      now,
      syncEnabled: true,
      syncTargetSeconds: 300,
    }),
    {
      nextDueAt: new Date("2026-06-02T17:49:59.000Z"),
      overdueAt: new Date("2026-06-02T17:55:00.000Z"),
      secondsUntilDue: -601,
      status: "overdue",
    },
  );
});

test("keeps sync due during the ordinary cron grace window", () => {
  assert.deepEqual(
    getCatalogSyncHealth({
      activeIncrementalJobCount: 0,
      latestIncrementalFinishedAt: new Date("2026-06-02T17:52:00.000Z"),
      now,
      syncEnabled: true,
      syncTargetSeconds: 300,
    }),
    {
      nextDueAt: new Date("2026-06-02T17:57:00.000Z"),
      overdueAt: new Date("2026-06-02T18:02:01.000Z"),
      secondsUntilDue: -180,
      status: "due",
    },
  );
});

test("reports enabled sync with no completed run as due now", () => {
  assert.deepEqual(
    getCatalogSyncHealth({
      activeIncrementalJobCount: 0,
      latestIncrementalFinishedAt: null,
      now,
      syncEnabled: true,
      syncTargetSeconds: 300,
    }),
    {
      nextDueAt: now,
      overdueAt: new Date("2026-06-02T18:05:01.000Z"),
      secondsUntilDue: 0,
      status: "due",
    },
  );
});

test("uses custom grace for the overdue wake-up deadline", () => {
  assert.deepEqual(
    getCatalogSyncHealth({
      activeIncrementalJobCount: 0,
      latestIncrementalFinishedAt: new Date("2026-06-02T17:52:00.000Z"),
      now,
      overdueGraceSeconds: 60,
      syncEnabled: true,
      syncTargetSeconds: 300,
    }),
    {
      nextDueAt: new Date("2026-06-02T17:57:00.000Z"),
      overdueAt: new Date("2026-06-02T17:58:01.000Z"),
      secondsUntilDue: -180,
      status: "overdue",
    },
  );
});

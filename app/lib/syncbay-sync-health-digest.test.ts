import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildSyncHealthDigest } from "./syncbay-sync-health-digest.ts";

const now = new Date("2026-06-20T12:00:00.000Z");

function jobAt(hoursAgo: number, status: string) {
  return {
    createdAt: new Date(now.getTime() - hoursAgo * 60 * 60 * 1000),
    status,
  };
}

test("reports ok when fresh with no failures or conflicts", () => {
  const digest = buildSyncHealthDigest({
    conflictsOpen: 0,
    healthStatus: "fresh",
    jobs: [jobAt(1, "SUCCEEDED"), jobAt(2, "SUCCEEDED")],
    now,
    quarantinedCount: 0,
    secondsUntilDue: 240,
  });

  assert.equal(digest.headline, "ok");
  assert.equal(digest.syncedCount, 2);
  assert.equal(digest.failedCount, 0);
  assert.equal(digest.lagBreached, false);
  assert.equal(digest.lagSeconds, 0);
});

test("flags attention on open conflicts or ordinary failures", () => {
  const digest = buildSyncHealthDigest({
    conflictsOpen: 3,
    healthStatus: "fresh",
    jobs: [jobAt(1, "FAILED")],
    now,
    quarantinedCount: 0,
    secondsUntilDue: 120,
  });

  assert.equal(digest.headline, "attention");
  assert.equal(digest.conflictsOpen, 3);
  assert.equal(digest.failedCount, 1);
});

test("flags degraded when a job is quarantined", () => {
  const digest = buildSyncHealthDigest({
    conflictsOpen: 0,
    healthStatus: "fresh",
    jobs: [jobAt(1, "FAILED")],
    now,
    quarantinedCount: 1,
    secondsUntilDue: 120,
  });

  assert.equal(digest.headline, "degraded");
  assert.equal(digest.quarantinedCount, 1);
});

test("exposes lag when the sync target is breached", () => {
  const digest = buildSyncHealthDigest({
    conflictsOpen: 0,
    healthStatus: "overdue",
    jobs: [],
    now,
    quarantinedCount: 0,
    secondsUntilDue: -900,
  });

  assert.equal(digest.lagBreached, true);
  assert.equal(digest.lagSeconds, 900);
  assert.equal(digest.headline, "degraded");
});

test("keeps due sync inside the cron grace window out of lag alerts", () => {
  const digest = buildSyncHealthDigest({
    conflictsOpen: 0,
    healthStatus: "due",
    jobs: [],
    now,
    quarantinedCount: 0,
    secondsUntilDue: -180,
  });

  assert.equal(digest.lagBreached, false);
  assert.equal(digest.lagSeconds, 0);
  assert.equal(digest.headline, "ok");
});

test("ignores jobs outside the window", () => {
  const digest = buildSyncHealthDigest({
    conflictsOpen: 0,
    healthStatus: "fresh",
    jobs: [jobAt(48, "SUCCEEDED"), jobAt(1, "SUCCEEDED")],
    now,
    quarantinedCount: 0,
    secondsUntilDue: 200,
    windowHours: 24,
  });

  assert.equal(digest.syncedCount, 1);
});

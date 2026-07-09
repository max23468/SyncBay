import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as retention from "./syncbay-retention-cleanup.ts";
// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { SYNCBAY_RETENTION_POLICIES } from "./syncbay-retention-policy.ts";

const {
  buildRetentionCleanupPlan,
  getRetentionCutoff,
  isExpiredAtCutoff,
  selectExpiredRecords,
} = retention;

const now = new Date("2026-06-20T00:00:00.000Z");

test("computes a cutoff retentionDays before now", () => {
  const cutoff = getRetentionCutoff(90, now);
  assert.equal(cutoff.toISOString(), "2026-03-22T00:00:00.000Z");
});

test("builds a plan covering every retention policy", () => {
  const plan = buildRetentionCleanupPlan({
    now,
    policies: SYNCBAY_RETENTION_POLICIES,
  });

  const areas = plan.map((target: { area: string }) => target.area).sort();
  assert.deepEqual(areas, [
    "account_deletion_no_match_requests",
    "account_deletion_requests",
    "audit_logs",
    "oauth_states",
    "product_snapshots",
    "shopify_webhook_audit_logs",
    "succeeded_sync_jobs",
    "sync_jobs",
  ]);

  const webhookAudit = plan.find(
    (target: { area: string }) => target.area === "shopify_webhook_audit_logs",
  );
  assert.equal(webhookAudit?.retentionDays, 30);
  assert.equal(webhookAudit?.cutoff.toISOString(), "2026-05-21T00:00:00.000Z");

  const syncJobs = plan.find(
    (target: { area: string }) => target.area === "sync_jobs",
  );
  assert.equal(syncJobs?.retentionDays, 90);
  assert.equal(syncJobs?.cutoff.toISOString(), "2026-03-22T00:00:00.000Z");
});

test("can restrict the plan to specific areas", () => {
  const plan = buildRetentionCleanupPlan({
    areas: ["oauth_states"],
    now,
    policies: SYNCBAY_RETENTION_POLICIES,
  });

  assert.equal(plan.length, 1);
  assert.equal(plan[0].area, "oauth_states");
  assert.equal(plan[0].cutoff.toISOString(), "2026-06-13T00:00:00.000Z");
});

test("plans a strict short cleanup window for no-match account deletion rows", () => {
  const plan = buildRetentionCleanupPlan({
    areas: ["account_deletion_no_match_requests"],
    now,
    policies: SYNCBAY_RETENTION_POLICIES,
  });

  assert.equal(plan.length, 1);
  assert.equal(plan[0].area, "account_deletion_no_match_requests");
  assert.equal(plan[0].retentionDays, 7);
  assert.equal(plan[0].cutoff.toISOString(), "2026-06-13T00:00:00.000Z");
});

test("classifies records as expired at or before the cutoff", () => {
  const cutoff = getRetentionCutoff(7, now);

  assert.equal(
    isExpiredAtCutoff(new Date("2026-06-12T00:00:00.000Z"), cutoff),
    true,
  );
  assert.equal(
    isExpiredAtCutoff(new Date("2026-06-13T00:00:00.000Z"), cutoff),
    true,
  );
  assert.equal(
    isExpiredAtCutoff(new Date("2026-06-19T00:00:00.000Z"), cutoff),
    false,
  );
  assert.equal(isExpiredAtCutoff(null, cutoff), false);
});

test("selects only expired records for a dry-run report", () => {
  const cutoff = getRetentionCutoff(30, now);
  const records = [
    { capturedAt: "2026-01-01T00:00:00.000Z", id: "old" },
    { capturedAt: "2026-06-18T00:00:00.000Z", id: "fresh" },
  ];

  const expired = selectExpiredRecords(records, cutoff, (r) => r.capturedAt);
  assert.deepEqual(
    expired.map((r) => r.id),
    ["old"],
  );
});

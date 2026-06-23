import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as retentionPolicy from "./syncbay-retention-policy.ts";

const {
  SYNCBAY_RETENTION_POLICIES,
  getRetentionPolicySummaryRows,
} = retentionPolicy;

test("defines conservative pilot retention windows", () => {
  assert.deepEqual(
    SYNCBAY_RETENTION_POLICIES.map((policy) => [
      policy.area,
      policy.retentionDays,
    ]),
    [
      ["audit_logs", 180],
      ["sync_jobs", 90],
      ["product_snapshots", 180],
      ["oauth_states", 7],
      ["account_deletion_no_match_requests", 7],
      ["account_deletion_requests", 365],
    ],
  );
});

test("keeps no-match account deletion retention separate from matched privacy records", () => {
  const noMatchPolicy = SYNCBAY_RETENTION_POLICIES.find(
    (policy: { area: string }) =>
      policy.area === "account_deletion_no_match_requests",
  );
  const matchedPolicy = SYNCBAY_RETENTION_POLICIES.find(
    (policy: { area: string }) => policy.area === "account_deletion_requests",
  );

  assert.equal(noMatchPolicy?.retentionDays, 7);
  assert.match(noMatchPolicy?.scope ?? "", /senza shop collegato/i);
  assert.equal(matchedPolicy?.retentionDays, 365);
});

test("formats retention rows without exposing sensitive data", () => {
  assert.deepEqual(getRetentionPolicySummaryRows()[0], {
    area: "Audit log",
    retention: "180 giorni",
    scope:
      "Eventi operativi e modifiche critiche, senza token o payload provider completi.",
  });
});

import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as retentionPolicy from "./syncbay-retention-policy.ts";

const {
  SYNCBAY_RETENTION_POLICIES,
  getRetentionPolicySummaryRows,
} = retentionPolicy;

test("defines conservative private retention windows", () => {
  assert.deepEqual(
    SYNCBAY_RETENTION_POLICIES.map((policy) => [
      policy.area,
      policy.retentionDays,
    ]),
    [
      ["shopify_webhook_audit_logs", 30],
      ["audit_logs", 180],
      ["succeeded_sync_jobs", 45],
      ["sync_jobs", 90],
      ["product_snapshots", 180],
      ["oauth_states", 7],
      ["account_deletion_no_match_requests", 7],
      ["account_deletion_requests", 365],
    ],
  );
});

test("uses shorter retention for noisy derived records", () => {
  const webhookAuditPolicy = SYNCBAY_RETENTION_POLICIES.find(
    (policy: { area: string }) => policy.area === "shopify_webhook_audit_logs",
  );
  const succeededJobsPolicy = SYNCBAY_RETENTION_POLICIES.find(
    (policy: { area: string }) => policy.area === "succeeded_sync_jobs",
  );

  assert.equal(webhookAuditPolicy?.retentionDays, 30);
  assert.match(webhookAuditPolicy?.scope ?? "", /webhook Shopify/i);
  assert.equal(succeededJobsPolicy?.retentionDays, 45);
  assert.match(succeededJobsPolicy?.scope ?? "", /riusciti/i);
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
  const auditLogRow = getRetentionPolicySummaryRows().find(
    (row: { area: string }) => row.area === "Audit log",
  );

  assert.deepEqual(auditLogRow, {
    area: "Audit log",
    retention: "180 giorni",
    scope:
      "Eventi operativi e modifiche critiche, senza token o payload provider completi.",
  });
});

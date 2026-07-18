import assert from "node:assert/strict";
import { test } from "vitest";

import * as retentionPolicy from "./syncbay-retention-policy.ts";

const { SYNCBAY_RETENTION_POLICIES } = retentionPolicy;

function getRetentionDays(area: string) {
  return SYNCBAY_RETENTION_POLICIES.find(
    (policy: { area: string }) => policy.area === area,
  )?.retentionDays;
}

test("defines conservative private retention windows", () => {
  assert.deepEqual(
    SYNCBAY_RETENTION_POLICIES.map((policy) => [
      policy.area,
      policy.retentionDays,
    ]),
    [
      ["shopify_webhook_audit_logs", 14],
      ["account_deletion_audit_logs", 30],
      ["succeeded_sync_job_audit_logs", 45],
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

test("keeps noisy or derived audit echoes below the critical audit window", () => {
  const criticalAuditDays = getRetentionDays("audit_logs");

  for (const area of [
    "shopify_webhook_audit_logs",
    "account_deletion_audit_logs",
    "succeeded_sync_job_audit_logs",
  ]) {
    assert.ok(
      (getRetentionDays(area) ?? Infinity) < (criticalAuditDays ?? 0),
      `${area} deve restare sotto la finestra degli audit critici`,
    );
  }
});

test("aligns each audit echo with the record it describes", () => {
  assert.equal(
    getRetentionDays("succeeded_sync_job_audit_logs"),
    getRetentionDays("succeeded_sync_jobs"),
  );
  assert.ok(
    (getRetentionDays("account_deletion_audit_logs") ?? Infinity) <
      (getRetentionDays("account_deletion_requests") ?? 0),
  );
});

test("keeps no-match account deletion retention separate from matched privacy records", () => {
  assert.ok(
    (getRetentionDays("account_deletion_no_match_requests") ?? Infinity) <
      (getRetentionDays("account_deletion_requests") ?? 0),
  );
});

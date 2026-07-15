export interface SyncBayRetentionPolicy {
  area:
    | "account_deletion_audit_logs"
    | "account_deletion_requests"
    | "account_deletion_no_match_requests"
    | "audit_logs"
    | "oauth_states"
    | "product_snapshots"
    | "shopify_webhook_audit_logs"
    | "succeeded_sync_job_audit_logs"
    | "succeeded_sync_jobs"
    | "sync_jobs";
  retentionDays: number;
}

// Le finestre e il motivo di ognuna stanno nella tabella di ADR 0017, che resta
// la fonte canonica.
export const SYNCBAY_RETENTION_POLICIES: SyncBayRetentionPolicy[] = [
  { area: "shopify_webhook_audit_logs", retentionDays: 14 },
  { area: "account_deletion_audit_logs", retentionDays: 30 },
  { area: "succeeded_sync_job_audit_logs", retentionDays: 45 },
  { area: "audit_logs", retentionDays: 180 },
  { area: "succeeded_sync_jobs", retentionDays: 45 },
  { area: "sync_jobs", retentionDays: 90 },
  { area: "product_snapshots", retentionDays: 180 },
  { area: "oauth_states", retentionDays: 7 },
  { area: "account_deletion_no_match_requests", retentionDays: 7 },
  { area: "account_deletion_requests", retentionDays: 365 },
];

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
  label: string;
  retentionDays: number;
  scope: string;
}

export const SYNCBAY_RETENTION_POLICIES: SyncBayRetentionPolicy[] = [
  {
    area: "shopify_webhook_audit_logs",
    label: "Audit webhook Shopify",
    retentionDays: 14,
    scope:
      "Tracce rumorose dei webhook Shopify ricevuti; il job e gli audit di esito restano la fonte diagnostica primaria.",
  },
  {
    area: "account_deletion_audit_logs",
    label: "Audit account deletion eBay",
    retentionDays: 30,
    scope:
      "Eco audit delle notifiche eBay account deletion ricevute; la prova di trattamento resta nelle richieste account deletion dedicate.",
  },
  {
    area: "succeeded_sync_job_audit_logs",
    label: "Audit job riusciti",
    retentionDays: 45,
    scope:
      "Eventi di esito positivo dei job, allineati alla finestra dei job riusciti.",
  },
  {
    area: "audit_logs",
    label: "Audit log",
    retentionDays: 180,
    scope:
      "Eventi operativi e modifiche critiche, senza token o payload provider completi.",
  },
  {
    area: "succeeded_sync_jobs",
    label: "Job SyncBay riusciti",
    retentionDays: 45,
    scope:
      "Job riusciti già sintetizzati in audit e snapshot, conservati per diagnostica recente senza storico indefinito.",
  },
  {
    area: "sync_jobs",
    label: "Job SyncBay",
    retentionDays: 90,
    scope: "Stati job, errori normalizzati, retry e riferimenti tecnici interni.",
  },
  {
    area: "product_snapshots",
    label: "Snapshot prodotto",
    retentionDays: 180,
    scope: "Baseline necessarie per conflitti, rollback e diagnostica catalogo.",
  },
  {
    area: "oauth_states",
    label: "State OAuth",
    retentionDays: 7,
    scope: "State hash temporanei e metadati minimi anti-CSRF.",
  },
  {
    area: "account_deletion_no_match_requests",
    label: "Richieste account deletion senza match",
    retentionDays: 7,
    scope:
      "Notifiche eBay senza shop collegato alla distribuzione privata, conservate brevemente per deduplica e diagnostica.",
  },
  {
    area: "account_deletion_requests",
    label: "Richieste account deletion",
    retentionDays: 365,
    scope: "Notifiche minimizzate, idempotenza e prova di trattamento privacy.",
  },
];

export function getRetentionPolicySummaryRows() {
  return SYNCBAY_RETENTION_POLICIES.map((policy) => ({
    area: policy.label,
    retention: `${policy.retentionDays} giorni`,
    scope: policy.scope,
  }));
}

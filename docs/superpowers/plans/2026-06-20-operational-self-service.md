# Operational Self-Service Implementation Plan

**Goal:** Implement the selected SyncBay improvements: persistent description rules, existing-product match suggestions, catalog health diagnostics, eBay rate-limit UI, full reconcile policy visibility, non-opaque quality checklist, and a concrete data retention policy.

**Architecture:** Keep the work inside the existing React Router, Prisma and pure `app/lib` patterns. Add small pure helpers for scoring, matching, catalog health and retention; persist description rules through Prisma and settings; expose operational diagnostics in existing embedded pages without creating new workers or provider integrations.

**Tech Stack:** TypeScript, React Router, Shopify Web Components (`s-*`), Prisma/Postgres, Node test runner.

---

### Task 1: Persistent Description Rules

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260620090000_add_description_rules/migration.sql`
- Create: `app/lib/syncbay-description-rules.ts`
- Modify: `app/services/syncbay.server.ts`
- Modify: `app/routes/app.settings.tsx`
- Test: `app/lib/syncbay-description-rules.test.ts`

- [x] Add `DescriptionRule` with one row per shop and modes `CLEAN_HTML`, `FULL_HTML`, `TEXT_ONLY`.
- [x] Add a pure normalizer that rejects unknown form values and returns Italian blocking copy.
- [x] Load and save the rule from `Impostazioni`, with audit log and no provider writes.
- [x] Show a settings card explaining the effect on future imports and cleanup previews.

### Task 2: Matching Suggestions and Quality Checklist

**Files:**
- Create: `app/lib/syncbay-product-matching.ts`
- Create: `app/lib/syncbay-quality-checklist.ts`
- Modify: `app/services/import-preview.server.ts`
- Modify: `app/routes/app.import-preview.tsx`
- Test: `app/lib/syncbay-product-matching.test.ts`
- Test: `app/lib/syncbay-quality-checklist.test.ts`

- [x] Add conservative match scoring for existing Shopify candidates: exact SKU, title similarity and barcode/ItemID references.
- [x] Add a non-opaque quality checklist that reports missing SKU, generated SKU, missing image, invalid price, invalid quantity, complex variants, weak category and cleaned description.
- [x] Surface checklist labels in import preview cards without changing import behavior.

### Task 3: Catalog Health and Rate-Limit Diagnostics

**Files:**
- Create: `app/lib/syncbay-catalog-health-center.ts`
- Modify: `app/lib/syncbay-job-diagnostics.ts`
- Modify: `app/services/syncbay.server.ts`
- Modify: `app/routes/app.activity.tsx`
- Test: `app/lib/syncbay-catalog-health-center.test.ts`
- Test: `app/lib/syncbay-job-diagnostics.test.ts`

- [x] Summarize catalog health into concrete causes: active stale rows, unknown availability, open conflicts, failed jobs and active incremental jobs.
- [x] Add rate-limit detail for eBay cooldown: provider label, safe retry time and UI summary.
- [x] Show the health center in `Attività` using existing dashboard data.

### Task 4: Full Reconcile Policy Visibility

**Files:**
- Create: `app/lib/syncbay-full-reconcile-policy.ts`
- Modify: `app/services/syncbay.server.ts`
- Modify: `app/routes/app.activity.tsx`
- Test: `app/lib/syncbay-full-reconcile-policy.test.ts`

- [x] Compute whether full reconcile is missing, fresh, due soon or overdue from the latest `catalog_reconcile` job.
- [x] Expose the next due timestamp and status in `Attività`.
- [x] Do not create new cron/queue behavior; this task is visibility and scheduling policy only.

### Task 5: Retention Policy

**Files:**
- Create: `app/lib/syncbay-retention-policy.ts`
- Test: `app/lib/syncbay-retention-policy.test.ts`
- Create: `docs/decisions/0017-retention-dati-operativi.md`
- Modify: `docs/DECISIONS.md`
- Modify: `docs/DECISIONS_PENDING.md`
- Modify: `docs/data-model.md`
- Modify: `CHANGELOG.md`

- [x] Define pilot retention windows for audit logs, job diagnostics, snapshots, OAuth state and account deletion records.
- [x] Document that cleanup jobs are not activated in this change.
- [x] Close the pending beta retention decision with a conservative pilot ADR.

### Verification

- [x] Run targeted failing tests before each implementation step.
- [x] Run `npm run test:lib`.
- [x] Run `npm run prisma:validate`.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Run `git diff --check`.

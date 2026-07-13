# SyncBay Conflict Diagnostics Implementation Plan

**Goal:** Make conflict handling and job retry diagnostics safer, clearer and ready for product screenshots.

**Architecture:** Keep the current Shopify CLI React Router app and existing Prisma models. Add pure helper modules for conflict action safety and job diagnostics, then wire them into the existing `Conflitti` and `Attività` routes without schema changes, new workers or provider writes.

**Tech Stack:** TypeScript, React Router, Prisma, native Node test runner, SyncBay embedded UI CSS.

---

### Task 1: Conflict Action Classification

**Files:**
- Create: `app/lib/syncbay-conflict-actions.ts`
- Create: `app/lib/syncbay-conflict-actions.test.ts`
- Modify: `app/services/syncbay.server.ts`
- Modify: `app/routes/app.conflicts.tsx`
- Modify: `app/styles/syncbay-embedded.css`

- [ ] **Step 1: Write failing tests for conflict action safety**

Add tests proving that quantity, price, status and SKU conflicts stay manual-only; description conflicts only allow batch-safe `KEEP_SHOPIFY`; title and images are guarded; unknown fields are manual-only.

- [ ] **Step 2: Verify the new tests fail**

Run: `npm run test:lib -- app/lib/syncbay-conflict-actions.test.ts`

Expected: failure because `app/lib/syncbay-conflict-actions.ts` does not exist yet.

- [ ] **Step 3: Implement the pure conflict classification helper**

Create `getConflictFieldDecisionMode`, `getConflictResolutionSafety`, `getSafeBatchConflictResolutions` and `summarizeConflictDecisionModes`.

- [ ] **Step 4: Verify tests pass**

Run: `npm run test:lib -- app/lib/syncbay-conflict-actions.test.ts`

Expected: all new conflict action tests pass.

- [ ] **Step 5: Wire guidance into Conflitti**

Show decision mode, safe batch counts and concise action guidance in `app/routes/app.conflicts.tsx`; add summary counts from `getConflictsPageState`.

### Task 2: Job Retry Diagnostics

**Files:**
- Create: `app/lib/syncbay-job-diagnostics.ts`
- Create: `app/lib/syncbay-job-diagnostics.test.ts`
- Modify: `app/services/syncbay.server.ts`
- Modify: `app/routes/app.activity.tsx`

- [ ] **Step 1: Write failing tests for retry safety**

Add tests proving that eBay Trading cooldown blocks manual retry until `runAfter`, failed stock jobs explain availability impact, and ordinary failed jobs remain retryable.

- [ ] **Step 2: Verify the new tests fail**

Run: `npm run test:lib -- app/lib/syncbay-job-diagnostics.test.ts`

Expected: failure because `app/lib/syncbay-job-diagnostics.ts` does not exist yet.

- [ ] **Step 3: Implement the job diagnostic helper**

Create `getSyncJobDiagnostic` and `getManualRetryState`; keep it pure and free of provider calls.

- [ ] **Step 4: Verify tests pass**

Run: `npm run test:lib -- app/lib/syncbay-job-diagnostics.test.ts`

Expected: all new job diagnostic tests pass.

- [ ] **Step 5: Wire diagnostics into Attività and retry action**

Show impact, next action and technical reference in timeline rows. Block manual retry for active eBay cooldowns in `requestSyncJobRetry`.

### Task 3: Product Screenshot And Microcopy Readiness

**Files:**
- Modify: `BRAND.md`
- Modify: `docs/guides/ui-concepts-handoff.md`
- Modify: `scripts/smoke-ui.mjs`

- [ ] **Step 1: Add screenshot-ready message guidance**

Update dashboard and product screenshot copy rules so screenshots focus on `Panoramica`, `Catalogo`, `Conflitti`, `Attività`, `Importazione` and `Impostazioni` with real-data-first guardrails.

- [ ] **Step 2: Extend smoke UI coverage**

Ensure `scripts/smoke-ui.mjs` checks the new safety and diagnostic copy markers.

### Task 4: Verification, Release And Publish

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `app/lib/version.ts`

- [ ] **Step 1: Update changelog**

Add versioned `[Non rilasciato]` entries under `### Novità` or `### Correzioni` for conflict safety, activity diagnostics and screenshot-ready microcopy.

- [ ] **Step 2: Run relevant gates**

Run: `npm run test:lib`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run smoke:ui`, `npm run release:dry-run`.

- [ ] **Step 3: Release locally if required**

If `[Non rilasciato]` contains versioned sections, run `npm run release`.

- [ ] **Step 4: Publish**

Self-review the diff, check Codex feedback inbox, commit with a Conventional Commit title, push the branch, open a PR with explicit title, merge to `main`, then clean up local and remote branches if safe.

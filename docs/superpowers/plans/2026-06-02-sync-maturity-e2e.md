# Sync Maturity E2E Rollback Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a real, reversible end-to-end test proving that SyncBay can update Shopify from eBay changes and update eBay stock from a Shopify paid order.

**Architecture:** This plan does not introduce a new runtime component. It uses the existing Prisma models, Shopify webhook routes, SyncBay runner, Trading API stock writer, Supabase Cron endpoint and diagnostic scripts, with strict baseline capture and rollback before any provider write is considered complete.

**Tech Stack:** Shopify CLI React Router app, TypeScript/Node 24, Prisma/Postgres on Supabase, Vercel production pilot, Shopify Admin GraphQL, eBay Trading API, existing SyncBay scripts.

---

## Execution Result - 2026-06-04

**Outcome:** `PASS`.

- The true Shopify Admin `orderCreate` path was verified with the offline
  session that now includes `write_orders`: Shopify delivered `orders/paid` to
  SyncBay and the production runner created `UPDATE_EBAY_STOCK` jobs.
- The first Admin order created with `financialStatus=PAID` was delivered with
  a delay; a second order using a documented `SALE/SUCCESS` transaction was
  created while investigating the delay. The two webhook jobs converged safely:
  one real allowlisted Trading API stock write changed eBay quantity `3 -> 2`,
  and the other job skipped the same line with `already_processed`.
- Rollback completed: eBay stock was restored to `3` with `GetItem`
  verification, Shopify stock on the SyncBay location was verified at `3`, the
  Vercel production allowlist was removed and production was redeployed, and no
  active `UPDATE_EBAY_STOCK` or `SYNC_INCREMENTAL` job remained.

**Follow-up:** no provider blocker remains for the MVP stock loop. Future tests
should create one paid Admin order with a `SALE/SUCCESS` transaction and wait
for webhook delivery before attempting a second order.

---

## Execution Result - 2026-06-02

**Outcome:** `PARTIAL_WITH_ROLLBACK`.

- eBay -> Shopify quantity sync passed on ItemID `156986744184`: eBay stock was changed from 3 to 2, the production runner synced Shopify to 2, then eBay and Shopify were restored to 3.
- Shopify -> eBay stock runner passed with a synthetic paid-order payload: a production `UPDATE_EBAY_STOCK` job for Shopify variant `gid://shopify/ProductVariant/48298613407966` reduced eBay stock from 3 to 2 with `updatedCount: 1`, `dryRun: true` and the temporary allowlist `ebay:156986744184`.
- A real Shopify Admin GraphQL `orderCreate` test did not run: Shopify rejected the mutation because the available CLI token lacks `write_orders` and `orderCreate` requires an offline app token with that scope.
- Rollback completed: eBay stock was restored to 3, Shopify stock was verified at 3, the Vercel production allowlist was removed and redeployed, no active job remained, and no open conflict remained on the selected item.

**Selected test target:**

```text
shopDomain = syncbay-dev.myshopify.com
ebayItemId = 156986744184
shopifyProductGid = gid://shopify/Product/9231310520542
shopifyVariantGid = gid://shopify/ProductVariant/48298613407966
shopifyLocationGid = gid://shopify/Location/87503503582
baselineQuantity = 3
testQuantity = 2
currency = EUR
price = 49.99
```

**Follow-up completed 2026-06-04:** the true Shopify Admin `orderCreate` path now
creates `orders/paid` webhook jobs and the allowlisted stock write was verified
with rollback.

---

## File Structure

- `docs/superpowers/specs/2026-06-02-sync-maturity-e2e-design.md`: approved design and rollback constraints.
- `docs/superpowers/plans/2026-06-02-sync-maturity-e2e.md`: this executable plan.
- `app/services/sync-job-runner.server.ts`: runtime job runner; read-only unless a verified defect blocks the test.
- `app/services/syncbay.server.ts`: webhook/job creation and conflict helpers; read-only unless a verified defect blocks the test.
- `scripts/syncbay-job-status.mjs`: sanitized remote job diagnostics.
- `scripts/syncbay-import-verify.mjs`: import/mapping/Shopify verification.
- `scripts/syncbay-restore-ebay-stock.mjs`: real eBay stock restoration script for the test item.
- `.env.example`: read-only for this plan unless a missing documented runtime flag is discovered.
- `CHANGELOG.md`: update only if versioned docs or code change during execution.

## Execution Rules

- Do not print secrets, bearer tokens, database URLs, Shopify access tokens, eBay OAuth tokens or raw customer/order data.
- Use the SyncBay eBay keyset only. The remembered operational label is `botCF 2`, not `botCF`.
- Keep `SYNCBAY_EBAY_STOCK_DRY_RUN=true` globally during the test.
- Use `SYNCBAY_EBAY_STOCK_REAL_WRITE_ALLOWLIST` only for the single selected ItemID or Shopify variant.
- End the test only after restoring eBay stock and runtime allowlist to the pre-test state.
- If a runtime code defect is found, stop provider writes, preserve evidence, write a separate bugfix task, and rerun local gates before resuming.

### Task 1: Stabilize Workspace State

**Files:**
- Read: `app/services/sync-job-runner.server.ts`
- Read: `app/services/syncbay.server.ts`
- Read: `docs/superpowers/specs/2026-06-02-sync-maturity-e2e-design.md`

- [ ] **Step 1: Inspect branch and dirty files**

Run:

```bash
git status --short --branch
git diff --name-only
```

Expected: only known user/runtime edits are dirty. If additional unrelated files appear, pause and report them.

- [ ] **Step 2: Review runtime diffs before testing**

Run:

```bash
git diff -- app/services/sync-job-runner.server.ts app/services/syncbay.server.ts
```

Expected: diffs are related to SyncBay description baseline/conflict baseline behavior. If they change stock writes, cron auth, webhook payload extraction or eBay API calls, stop and ask for direction before provider writes.

- [ ] **Step 3: Confirm the approved spec is available**

Run:

```bash
test -f docs/superpowers/specs/2026-06-02-sync-maturity-e2e-design.md
sed -n '1,180p' docs/superpowers/specs/2026-06-02-sync-maturity-e2e-design.md
```

Expected: the spec states one listing, baseline first, rollback mandatory, and allowlist-limited eBay writes.

### Task 2: Run Local Safety Gates

**Files:**
- Test: `app/lib/syncbay-stock-guard.test.ts`
- Read: `prisma/schema.prisma`
- Read: `package.json`

- [ ] **Step 1: Run stock guard tests**

Run:

```bash
npm run test:stock-guard
```

Expected: PASS. If it fails, do not run provider tests; diagnose the guard first.

- [ ] **Step 2: Validate Prisma schema**

Run:

```bash
npm run prisma:validate
```

Expected: Prisma schema validates. If it fails because local database URLs are absent, inspect the script output and decide whether this is environment-only or schema-related before continuing.

- [ ] **Step 3: Check current remote job state**

Run:

```bash
npm run jobs:status -- --shop syncbay-dev.myshopify.com
```

Expected: sanitized output only. There must be no active `UPDATE_EBAY_STOCK` or `SYNC_INCREMENTAL` job for the selected shop before baseline capture.

```bash
npm run orders:paid-readiness -- --shop syncbay-dev.myshopify.com
```

Expected: sanitized output only. `Runtime webhook orders/paid` must be `pronto`;
`Test Admin orderCreate` is `pronto` only when the offline session also has
`write_orders`. If only `write_orders` is missing, ask the maintainer to
authorize the new scope, deploy the updated app configuration, then reopen the
Shopify app to refresh the offline session before attempting the Admin GraphQL
order creation path.

### Task 3: Select One Safe Test Mapping

**Files:**
- Read: `scripts/syncbay-job-status.mjs`
- Read: `scripts/syncbay-import-verify.mjs`
- Read: `docs/guides/provisioning-runtime.md`

- [ ] **Step 1: Verify current import/mapping health**

Run:

```bash
npm run import:verify -- --shop syncbay-dev.myshopify.com --sample 5
```

Expected: a sanitized sample verifies mapping, snapshot and Shopify product alignment. If the script exposes no safe candidate, use the next step to select from the database without printing secrets.

- [ ] **Step 2: Select a candidate from sanitized diagnostics**

Use these selection rules:

```text
shopDomain = syncbay-dev.myshopify.com
marketplaceId = EBAY_IT
currency = EUR
mapping.status = ACTIVE
shopifyProductGid is present
shopifyVariantGid is present
latest snapshot quantity >= 2
no open SyncConflict on the mapping
product is non-critical test inventory
```

Expected: one ItemID and one Shopify variant are selected. Record only sanitized identifiers in the working notes: ItemID, Product GID, Variant GID, SKU if present, quantity, price, currency.

- [ ] **Step 3: Stop if the candidate is unsafe**

Stop if any of these is true:

```text
currency is not EUR
quantity is missing or lower than 2
mapping is missing Shopify product or variant
there is an open conflict
the product is part of a real sales-critical listing
job queue has active stock or sync work for the shop
```

Expected: no provider writes happen when a stop condition is true.

### Task 4: Capture Baseline

**Files:**
- Read: `app/services/ebay-trading-preview.server.ts`
- Read: `scripts/syncbay-restore-ebay-stock.mjs`
- Read: `scripts/syncbay-import-verify.mjs`

- [ ] **Step 1: Capture SyncBay and Shopify baseline**

Run:

```bash
npm run import:verify -- --shop syncbay-dev.myshopify.com --sample 1
npm run jobs:status -- --shop syncbay-dev.myshopify.com
```

Expected: sanitized output includes enough evidence to confirm current mapping, product status, price and inventory on the SyncBay default location. Save the relevant values in the test notes, not in source files.

- [ ] **Step 2: Capture eBay baseline through the existing restore script read path**

Run the restore script only if it supports a verification/read mode in its help:

```bash
npm run stock:restore-ebay -- --help
```

Expected: help text confirms the script verifies current eBay stock with Trading API `GetItem` before a confirmed restore. If no read-only mode exists, do not improvise a raw token/API command in chat; use the script during rollback only and capture the eBay quantity from the latest trusted SyncBay snapshot.

- [ ] **Step 3: Define rollback target**

Record these rollback values in local working notes:

```text
rollbackItemId = selected ItemID
rollbackQuantity = latest trusted eBay/SYNCBAY quantity before test
rollbackAllowlist = previous SYNCBAY_EBAY_STOCK_REAL_WRITE_ALLOWLIST value
rollbackDryRun = previous SYNCBAY_EBAY_STOCK_DRY_RUN value
```

Expected: rollback target is known before any Shopify order test.

### Task 5: Test eBay -> Shopify Sync

**Files:**
- Read: `app/services/sync-job-runner.server.ts`
- Read: `app/services/shopify-draft-import.server.ts`
- Read: `app/services/ebay-trading-preview.server.ts`

- [ ] **Step 1: Prefer a quantity-only eBay change for the first real pass**

Use only a quantity change in the first pass because the repo already contains a verified stock restore tool. Do not change description or price until a reversible edit path for those fields is confirmed.

Expected: the test proves the runner can ingest an eBay-side catalog change without expanding rollback risk.

- [ ] **Step 2: Apply the temporary eBay quantity change**

Use the safest available eBay-side control for the selected listing:

```text
newEbayQuantity = rollbackQuantity - 1
minimum allowed newEbayQuantity = 1
```

Expected: the eBay listing quantity is temporarily reduced by one. If the only available path would affect multiple listings or requires broad credentials, stop.

- [ ] **Step 3: Trigger or wait for the SyncBay runner**

Run:

```bash
npm run jobs:status -- --shop syncbay-dev.myshopify.com
```

If no incremental job runs within the configured cron window, trigger the protected runner from the deployed environment only with the configured secret source, without printing the secret.

Expected: a `SYNC_INCREMENTAL` job is created and completed for the shop.

- [ ] **Step 4: Verify Shopify reflects the eBay change**

Run:

```bash
npm run import:verify -- --shop syncbay-dev.myshopify.com --sample 5
```

Expected: selected product/variant shows the temporary quantity on the SyncBay default location, or the job result contains a clear retry/error reason.

### Task 6: Test Shopify Paid Order -> eBay Stock

**Files:**
- Read: `app/routes/webhooks.orders.paid.tsx`
- Read: `app/services/syncbay.server.ts`
- Read: `app/services/sync-job-runner.server.ts`
- Read: `app/lib/syncbay-stock-guard.ts`
- Read: `app/services/ebay-trading-stock.server.ts`

- [ ] **Step 1: Confirm runtime write safety flags**

Before creating the paid order, confirm from provider runtime settings, without printing values:

```text
SYNCBAY_EBAY_STOCK_DRY_RUN is true
SYNCBAY_EBAY_STOCK_REAL_WRITE_ALLOWLIST is empty or narrower than one selected target
```

Expected: global dry-run is enabled before allowlisting.

- [ ] **Step 2: Narrow the real-write allowlist**

Set the allowlist to one of these exact token shapes for the selected target:

```text
ebay:$SELECTED_ITEM_ID
variant:$SELECTED_SHOPIFY_VARIANT_ID
syncbay-dev.myshopify.com:$SELECTED_ITEM_ID
```

Expected: only the selected item or variant can bypass dry-run.

- [ ] **Step 3: Create one paid Shopify test order for quantity 1**

Use the Shopify dev store flow for the selected product only. Do not include customer personal data in notes. Keep the order currency as `EUR`.

Expected: Shopify sends `orders/paid`, and SyncBay creates one `UPDATE_EBAY_STOCK` job.

- [ ] **Step 4: Drain and inspect the stock job**

Run:

```bash
npm run jobs:status -- --shop syncbay-dev.myshopify.com
```

Expected: `UPDATE_EBAY_STOCK` has priority over sync/conflict jobs and finishes with `updatedCount: 1`, or fails/retries with a clear diagnostic. If `plannedCount: 1` and `updatedCount: 0`, the allowlist did not match and eBay was not changed.

- [ ] **Step 5: Verify eBay quantity after paid order**

Use existing sanitized diagnostics and the stock restore script verification behavior.

Expected:

```text
expectedEbayQuantityAfterOrder = temporaryEbayQuantity - 1
```

If the observed quantity differs, stop and restore baseline before further testing.

### Task 7: Roll Back Provider and Runtime State

**Files:**
- Run: `scripts/syncbay-restore-ebay-stock.mjs`
- Read: `docs/guides/provisioning-runtime.md`

- [ ] **Step 1: Restore eBay stock**

Run with the selected ItemID and baseline quantity from Task 4:

```bash
npm run stock:restore-ebay -- --item-id "$ROLLBACK_ITEM_ID" --quantity "$ROLLBACK_QUANTITY" --confirm-real-ebay-write
```

Expected: the script refuses to run if active stock/sync jobs exist, calls Trading API `ReviseInventoryStatus`, verifies with `GetItem`, and records a SyncBay snapshot with restore metadata.

- [ ] **Step 2: Clear or restore the runtime allowlist**

In Vercel production runtime settings, restore:

```text
SYNCBAY_EBAY_STOCK_REAL_WRITE_ALLOWLIST = rollbackAllowlist
SYNCBAY_EBAY_STOCK_DRY_RUN = rollbackDryRun
```

Expected: if the allowlist was empty before the test, it is empty again.

- [ ] **Step 3: Run final sync to return Shopify to baseline**

Run:

```bash
npm run jobs:status -- --shop syncbay-dev.myshopify.com
npm run import:verify -- --shop syncbay-dev.myshopify.com --sample 5
```

Expected: Shopify product/variant is aligned with restored eBay stock on the SyncBay default location.

- [ ] **Step 4: Confirm no active job residue**

Run:

```bash
npm run jobs:status -- --shop syncbay-dev.myshopify.com
```

Expected: no `UPDATE_EBAY_STOCK` or `SYNC_INCREMENTAL` job remains `RUNNING`, and any `FAILED` job is explained with a concrete diagnostic.

### Task 8: Decide Next Development Work

**Files:**
- Modify if needed: `docs/ROADMAP.md`
- Modify if needed: `docs/CONTEXT.md`
- Modify if needed: `docs/guides/provisioning-runtime.md`
- Modify if needed: `CHANGELOG.md`

- [ ] **Step 1: Classify the result**

Classify with one of these outcomes:

```text
PASS: both flows work and rollback completed
PARTIAL: one flow works and rollback completed
BLOCKED: provider/setup prevents real test and no provider state changed
FAIL_WITH_ROLLBACK: defect found, rollback completed
FAIL_NEEDS_MANUAL_RESTORE: rollback did not complete automatically
```

Expected: no ambiguous "seems fine" result.

- [ ] **Step 2: Update docs only if the project state changed**

If the test proves a new stable fact, update the smallest relevant document:

```text
docs/ROADMAP.md: remove or revise the completed verification item
docs/CONTEXT.md: update current state and remaining risks
docs/guides/provisioning-runtime.md: add verified test result or operational caveat
CHANGELOG.md: add Non versionato entry for meaningful docs-only state update
```

Expected: docs reflect evidence, not assumptions.

- [ ] **Step 3: If code changed, run standard gates**

If runtime code is modified during execution, run:

```bash
npm run typecheck
npm run lint
npm run build
npm run prisma:validate
```

Expected: all pass before any commit claiming a runtime fix.

- [ ] **Step 4: Final state check**

Run:

```bash
git status --short --branch
git diff --check
```

Expected: only intentional docs/code changes remain. Provider runtime allowlist and eBay stock are restored before reporting completion.

## Self-Review

- Spec coverage: baseline, one listing, eBay -> Shopify, Shopify paid order -> eBay, allowlist, rollback and stop criteria are covered by Tasks 1-7.
- Scope check: price, description and new products are intentionally not part of the first real provider pass because the repo currently has a safe stock restore script, while reversible price/description edit tooling is not established in this plan.
- Incomplete-value scan: dynamic values are represented as shell variables or selected identifiers produced by earlier tasks, not as permanent blanks in source files.
- Residual risk: if the Shopify paid order flow requires interactive Admin work, the execution agent must use the browser/Shopify UI carefully and avoid exposing customer/order personal data in chat or screenshots.

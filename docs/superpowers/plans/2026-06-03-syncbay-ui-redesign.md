# SyncBay UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the current technical SyncBay dashboard into a Shopify-native, customer-ready embedded app with six clear surfaces: `Panoramica`, `Catalogo`, `Conflitti`, `Importazione`, `Attività`, `Impostazioni`.

**Architecture:** Keep the existing Shopify CLI React Router scaffold, App Bridge, Prisma models and SyncBay service layer. Treat the six concept images as directional references, not pixel-perfect specs; the written plan, real Shopify components and real data contracts win when there is a conflict. Before UI implementation, complete a documentation-only Phase 0 that maps each page to real loaders, actions, empty states and missing data, then redistribute existing dashboard/import/settings data into route-level pages without new providers, workers, schema changes or legacy Polaris React.

**Tech Stack:** React Router app routes, TypeScript, Shopify App Bridge React `NavMenu`, Shopify/Polaris web components already used through `s-*`, Prisma/Postgres data already present, CSS tokens under the app root, existing `npm` quality gates.

---

## Execution Status

Status on 2026-06-05: Phases 0-4 are implemented and published in the pilot
Vercel production app. Phase 5 is the active closeout pass: update canonical
docs, review the six embedded pages post-publish, remove customer-visible legacy
UI residues, run local gates, classify the release and publish the final patch.

Post-publish review found two material residues:

- `Panoramica` still offered `Ricollega eBay` in the recommended action row even
  when eBay was already connected. The action should appear only when the
  connection is missing, expired, revoked or requires reconnect.
- `Attività` exposed `Audit` as a customer-facing filter/metric and did not make
  recent conflicts a first-class timeline filter. The page should surface
  `Conflitti` and keep technical audit details secondary.

No provider, schema, worker or integration change is part of this closeout.

## Source Inputs

- Decision handoff and full transcript: `docs/guides/ui-concepts-handoff.md`.
- Final concept images: `docs/assets/ui-concepts/2026-06-03/`.
- Current embedded app routes:
  - `app/routes/app.tsx`
  - `app/routes/app._index.tsx`
  - `app/routes/app.import-preview.tsx`
  - `app/routes/app.settings.tsx`
- Current data service: `app/services/syncbay.server.ts`.
- Brand rules: `BRAND.md`.
- Product plan: `docs/syncbay-product-technical-plan.md`.
- Navigation and current route discovery: `app/routes.ts` uses `flatRoutes()`, so new files such as `app.catalog.tsx`, `app.conflicts.tsx` and `app.activity.tsx` become routes without manual router edits.
- Phase 0 code evidence:
  - `app/routes/app._index.tsx` already loads `getDashboardState(session)`.
  - `app/routes/app.import-preview.tsx` already loads `getImportWizardState(session)` plus Shopify locations.
  - `app/routes/app.settings.tsx` already loads `getShopSettingsState(session, admin)`.
  - `prisma/schema.prisma` already contains `SyncJob`, `ProductMapping`, `ProductSnapshot`, `SyncConflict` and `AuditLog`.

## Coverage Check From The Two Threads

This plan integrates these decisions from the recovered threads:

| Thread decision | Plan coverage |
| --- | --- |
| Work is concept-to-code, not a quick CSS polish. | Tasks are phased by shell, data helpers, routes, smoke checks and visual QA. |
| The six Image Gen concepts are directional references, not pixel-perfect specs. | Visual QA checks hierarchy, density, copy, color and anatomy; implementation follows real Shopify components and written decisions first. |
| Before UI work, review real data contracts to avoid double work. | New Phase 0 documents loaders, actions, real data, missing data, empty states and decisions per page before runtime edits. |
| Implementation should be real-data first, not static mock screens. | Phase 0 and route tasks reuse existing loaders/actions where available and add server-side selectors for missing pages; demo/empty states are explicit. |
| Home must be a daily operating center, not a permanent wizard. | Task 4 rebuilds `/app` as `Panoramica` with next action first. |
| Final nav order: `Panoramica`, `Catalogo`, `Conflitti`, `Importazione`, `Attività`, `Impostazioni`. | Task 2 sets exactly these six nav items. |
| `Diagnostica` is not a nav item. | Task 8 puts diagnostics inside `Attività`; Task 9 keeps advanced diagnostics inside `Impostazioni > Avanzate`. |
| `Account` is not a nav item. | Task 7 keeps eBay connection inside `Importazione`; Task 9 puts account/ricollegamento inside `Avanzate`. |
| `Dashboard` label is rejected. Use `Panoramica`. | All plan labels use `Panoramica`. |
| eBay remains catalog source of truth, Shopify is destination, except Shopify paid orders update eBay stock. | Non-scope and copy guardrails prohibit export/bidirectional catalog UI. |
| Avoid `Esporta`, bidirectional arrows and broad `Sincronizza tutto`. | Tasks 4, 5 and 8 explicitly remove those patterns. |
| Use updated Shopify-native components, not legacy Polaris React. | Task 2 uses App Bridge `NavMenu`; Task 3 keeps `s-*` components and lightweight CSS. |
| Visual direction: 75% Shopify-native, 25% SyncBay. | Task 3 defines tokens, compact surfaces and restrained accents from `BRAND.md`. |
| Use real SyncBay logo in implementation, not generated logos. | Task 3 uses repo assets or an inline component derived from approved assets; concepts are references, not logo sources. |
| eBay/Shopify marks are allowed only as sober indicators, not co-branding. | Task 3 includes this as a visual guardrail. |
| Competitor inspiration: QuickSync/Infoshore/Marketplace Connect/DPL style clarity, not marketplace-suite complexity. | Scope keeps SyncBay narrow: import, catalog sync, conflicts, activity and settings only. |
| `Catalogo` is table-first, not a product editor. | Task 5 creates a product-control table, not editing surfaces. |
| Catalog first column is thumbnail + title, with SKU/ItemID secondary. | Task 5 table anatomy uses `Prodotto` with thumbnail, title and secondary identifiers. |
| Do not show separate primary columns `Stato Shopify` and `Stato SyncBay`. | Task 5 uses one computed `Stato` badge. |
| Catalog filters differ from import filters. | Task 5 and Task 7 define separate filters. |
| `Conflitti` defaults to open conflicts, with resolved history secondary. | Task 6 implements `Aperti`, `Risolti`, `Tutti`. |
| Conflict actions are `Usa valore eBay`, `Mantieni Shopify`, `Ignora campo`. | Task 6 maps existing enum actions to customer-facing labels. |
| `Importazione` is one page with progressive steps. | Task 7 keeps one route and rebuilds it as a step flow. |
| Default publication status and channel policy live in `Impostazioni`; `Importazione` shows summary + shortcut. | Task 7 and Task 9 split responsibility this way. |
| `Attività` is a timeline with diagnostics secondary. | Task 8 turns jobs/audit/errors into a readable timeline and collapses technical details. |
| `Impostazioni` must have four vertical boxes, one below another, not a four-column row. | Task 9 defines a one-column layout for the four boxes. |
| `Impostazioni` boxes: `Sync catalogo`, `Import prodotti`, `Canali di vendita`, `Avanzate`. | Task 9 uses exactly these four boxes. |
| Existing UI functions must not disappear without an explicit decision. | Each route task lists preservation requirements and smoke checks. |
| Two implicit user levels: negoziante first, diagnostics/operator second. | Copy and layout tasks keep technical details in disclosures or advanced sections. |
| Use `Quantità da verificare`, not `Disponibilità non protetta`. | Task 1 state helper and Task 4 copy priority use this label, after the eBay connection prerequisite. |
| If eBay is missing or expired, that is the top next-action priority. | Task 1 and Task 4 put `Collegamento eBay mancante o scaduto` before all operational issues. |
| Setup/import block appears only when a prerequisite or blocking state exists. | Task 4 next-action logic hides onboarding when shop is operational. |
| `Attività` concept may show `Sincronizza tutto`, but implementation should remove or narrowly scope it. | Task 8 excludes broad manual sync. |
| Preserve final six concept images in the repo. | Source inputs point to `docs/assets/ui-concepts/2026-06-03/`. |

## Scope

Build:

- Phase 0 documentation for data contracts before runtime UI changes.
- Six embedded app surfaces with the agreed nav and labels.
- Customer-facing Italian copy, with technical details secondary.
- Shared UI helpers for next action, badge labels, status labels and timeline grouping.
- Route loaders/actions that reuse existing SyncBay data and actions.
- Smoke checks and visual QA against the six accepted concept images.

Do not build:

- New eBay integrations, new Shopify/eBay provider behavior or new worker runtime.
- Catalog export Shopify -> eBay.
- Bidirectional catalog sync.
- Billing, Shopify App Store publishing or public release flow.
- Polaris React legacy migration.
- A fully custom design system detached from Shopify Admin.
- Mobile-first redesign. Mobile must not break, but desktop Shopify Admin is the primary target.

## Chosen Approach

Use the current app as the source of truth for behavior, complete a short data-contract pass, then redistribute real data into route-level pages.

```text
app/routes/app.tsx
  -> shared embedded shell and NavMenu
  -> /app                Panoramica
  -> /app/catalog        Catalogo
  -> /app/conflicts      Conflitti
  -> /app/import-preview Importazione
  -> /app/activity       Attività
  -> /app/settings       Impostazioni

app/services/syncbay.server.ts
  -> existing dashboard/import/settings state
  -> add page-specific selectors only where existing state is too broad or where a new route has no loader yet

app/lib/syncbay-ui-state.ts
  -> pure state/copy helpers tested without provider calls
```

Data strategy:

- Use existing real loaders/actions for `Panoramica`, `Importazione` and `Impostazioni`.
- Add real server-side selectors for `Catalogo`, `Conflitti` and `Attività`.
- Use explicit empty states when the shop has no records yet.
- Use the existing import preview mock fallback only where it already represents a declared local preview mode.
- Do not build static mock pages disconnected from Prisma/Shopify session state.
- Do not finish unrelated backend/runtime work before UI; Phase 0 documents contracts, then UI implementation proceeds tranche by tranche.

The rejected alternatives are:

- a single custom dashboard page with internal tabs, because it would keep SyncBay feeling like one technical panel and would not match the Shopify sidebar pattern discussed in the threads;
- a pixel-perfect Image Gen translation, because generated screenshots are not reliable for logo, components, exact copy and real states;
- completing all backend/runtime work before UI, because that would turn a redesign into an open-ended product build.

## File Structure

- Modify: `app/routes/app.tsx`
  - Add App Bridge navigation and shared embedded app shell behavior.
- Modify: `app/root.tsx`
  - Add the SyncBay embedded stylesheet link if CSS is implemented as a global app stylesheet.
- Create: `app/styles/syncbay-embedded.css`
  - Shared tokens, layout utilities, table density, timeline, badges and responsive rules.
- Create: `app/lib/syncbay-ui-state.ts`
  - Pure helpers for next action, status labels, conflict action labels and timeline labels.
- Create: `app/lib/syncbay-ui-state.test.ts`
  - Node tests for helper priority and labels.
- Modify: `app/routes/app._index.tsx`
  - Rebuild as `Panoramica`.
- Create: `app/routes/app.catalog.tsx`
  - New `Catalogo` page.
- Create: `app/routes/app.conflicts.tsx`
  - New `Conflitti` page.
- Modify: `app/routes/app.import-preview.tsx`
  - Rebuild as `Importazione`, preserving existing actions.
- Create: `app/routes/app.activity.tsx`
  - New `Attività` page.
- Modify: `app/routes/app.settings.tsx`
  - Rebuild four vertical settings boxes.
- Modify: `app/services/syncbay.server.ts`
  - Add page-specific read functions only when route data cannot safely come from existing functions.
- Modify: `scripts/smoke-ui.mjs`
  - Replace old dashboard text needles with the new six-surface checks.
- Modify if implementation changes visible product behavior: `CHANGELOG.md`.
  - Classify as `PATCH` or `MINOR` only after actual code diff is known.
- Update after implementation: `docs/guides/ui-concepts-handoff.md`.
  - Record final implementation notes, deviations and visual QA evidence.

## Implementation Phases

These are review units, not necessarily separate PRs. Phase 1 should stay separate so the visual language can be corrected before it spreads.

1. **Phase 0: data contracts, documentation only**
   - Update this plan with per-page real data, missing data, loader/action, empty-state and risk decisions.
   - No runtime code changes.
2. **Phase 1: foundations and Panoramica**
   - Pure UI helpers, embedded shell/nav, shared visual system and `Panoramica`.
3. **Phase 2: Catalogo and Conflitti**
   - Product-control table and conflict workflow, both backed by Prisma selectors/actions.
4. **Phase 3: Importazione and Impostazioni**
   - Step-based import flow and four vertical settings boxes, preserving existing actions.
5. **Phase 4: Attività**
   - Operational timeline and secondary diagnostics from jobs/audit/conflict events.
6. **Phase 5: QA finale**
   - Local gates, smoke checks, browser visual QA and docs/release
     classification.
   - Status 2026-06-05: in chiusura post-publish; review production eseguita
     contro le sei superfici e i sei concept, con correzioni runtime limitate a
     Panoramica e Attività.

## Phase 0 Data Contracts

Phase 0 is satisfied by this section. It is documentation-only and must be revisited only if runtime code inspection contradicts these contracts during implementation.

### Cross-Page Contract Rules

- Every embedded route authenticates through the existing parent `/app` route and must keep Shopify Admin auth behavior unchanged.
- Real data wins over demo data. Empty shops show clear empty states and links to the next setup/import action.
- Do not create schema migrations for the UI pass. Existing models are enough for the first redesign.
- Do not add new provider calls for presentation only. Shopify/eBay calls remain limited to existing route/service responsibilities unless a route already needs them.
- Do not expose raw payloads, job ids, scopes or provider terms in the primary customer layer.
- Page-specific selectors may be added to `app/services/syncbay.server.ts` if the current broad dashboard state would make the route fragile or wasteful.

### Panoramica

Current real source:

- Route: `app/routes/app._index.tsx`.
- Loader: `getDashboardState(session)`.
- Existing actions: `requestSyncJobRetry` and `resolveSyncConflict`, though the redesigned home should mostly route users to `Attività` and `Conflitti`.

Available data:

- shop domain, sync enabled flag, target seconds and default product status;
- eBay connection status and runtime readiness;
- Shopify scope/webhook readiness;
- import readiness, import counts and latest import run summary;
- mapping count, snapshot count and open conflict count;
- recent jobs, failed jobs, catalog sync health and audit messages.

Missing or derived data:

- `Quantità da verificare` is not a dedicated database field. Derive it conservatively from stock-related conflicts, failed/retrying `UPDATE_EBAY_STOCK` jobs and relevant catalog health signals. If no reliable count exists, show a state label without inventing a product count.
- `Collegamento eBay mancante o scaduto` derives from `ebay.status` plus runtime OAuth readiness.

Empty states:

- no eBay connection: primary next action links to `/auth/ebay/start` when OAuth is available, otherwise to `Importazione`/advanced setup copy;
- no mappings: next action points to `Importazione`;
- no issues: show `Tutto sotto controllo`.

Decision:

- Keep `getDashboardState` as the source. Add only the minimal fields needed for the corrected priority order.

### Catalogo

Current real source:

- No route yet.
- Existing models: `ProductMapping`, `ProductSnapshot`, `SyncConflict`, `SyncJob`.

Available data:

- mapping identity, eBay ItemID, SKU, Shopify product/variant GIDs, mapping status, last sync timestamp and last error;
- latest product snapshots for title, SKU, price, currency, quantity, product status, image count and sanitized payload;
- open conflicts per mapping;
- failed/retrying jobs related to mappings when linkable by payload or eBay ItemID.

Missing or derived data:

- thumbnail is available only if a sanitized image URL exists in snapshot payload. If not, use a neutral placeholder cell, not fake product art.
- live Shopify product title/status should not be fetched per row in the first UI pass unless an existing service already exposes it safely. Prefer snapshots for the first implementation.
- `Aggiornato`, `Da controllare`, `Non aggiornato` and `Errore` are computed UI statuses, not new DB states.

Empty states:

- no product mappings: show `Nessun prodotto collegato` with a primary link to `Importazione`;
- only archived mappings: default table can show archived rows through filter, with neutral status.

Decision:

- Add a real catalog selector in `app/services/syncbay.server.ts`. No static catalog mock and no schema migration.

### Conflitti

Current real source:

- Current dashboard already reads recent open conflicts and reuses `resolveSyncConflict`.
- No dedicated route yet.

Available data:

- conflict id, field, status, resolution, eBay value, last SyncBay value, Shopify value, detected/resolved timestamps;
- mapping relation with eBay ItemID and Shopify product GID;
- latest snapshots can provide title/thumbnail context when available.

Missing or derived data:

- human impact text must be derived from field and sync behavior, for example stock/price/title/description/image copy. Do not show enum values as primary copy.

Empty states:

- no open conflicts: show a calm all-clear state and secondary link/history for resolved conflicts.

Decision:

- Add a dedicated conflicts route and selector. Reuse `resolveSyncConflict` unchanged for actions.

### Importazione

Current real source:

- Route: `app/routes/app.import-preview.tsx`.
- Loader: `getImportWizardState(session)` plus Shopify locations.
- Actions: save location, rename location and start catalog import jobs.

Available data:

- eBay connection status;
- live eBay preview when connected;
- declared mock/local preview fallback when not connected;
- default product status, preview summary, import blockers, validation rules, runtime phases;
- Shopify locations and location rename readiness;
- draft/import job scheduling state.

Missing or derived data:

- publication channel summary currently lives in settings state. For the import summary, either add a lightweight settings/publication summary to the wizard loader or route users to `Impostazioni` for full details.

Empty states:

- no eBay connection: Step 1 explains connection and links to connect/reconnect;
- no Shopify location: Step 2 asks for location;
- preview unavailable: show blocker, not fake importable rows unless the existing mock preview mode is explicitly labeled.

Decision:

- Preserve the existing real wizard and actions. Reframe layout and copy only.

### Impostazioni

Current real source:

- Route: `app/routes/app.settings.tsx`.
- Loader: `getShopSettingsState(session, admin)`.
- Actions: save sync settings, save import default status, save publication channels.

Available data:

- sync enabled flag, target seconds, active mapping count and enablement blockers;
- default import product status;
- publication mode, selected publication IDs and available Shopify publications;
- enough eBay connection information exists inside the service to compute blockers.

Missing or derived data:

- eBay connection status is not currently returned to the route as a display field. Add it to settings state if `Avanzate` needs to show connect/reconnect state.
- advanced diagnostics may link to `Attività` instead of duplicating every technical field.

Empty states:

- no publications readable: show the existing unavailable/error message;
- sync cannot be enabled: show blockers in `Sync catalogo`.

Decision:

- Preserve existing actions. Reorganize into four vertical boxes and expose only minimal advanced connection/diagnostic data.

### Attività

Current real source:

- No route yet.
- Existing models and dashboard state already read `SyncJob`, import job summaries and `AuditLog`.
- Existing action `requestSyncJobRetry` can retry eligible jobs.

Available data:

- recent jobs with type, status, attempts, runAfter, started/finished timestamps and sanitized errors;
- latest import run summary;
- audit log messages and details;
- conflict events can be represented from recent conflicts and conflict resolution audit entries.

Missing or derived data:

- there is no unified `ActivityEvent` model. Build a view-model from jobs and audit logs without schema changes.
- affected counts must come from job payload/result only when safe and sanitized. If unavailable, omit counts.

Empty states:

- no jobs or audit logs: show `Nessuna attività registrata` and link back to `Panoramica`/`Importazione`.

Decision:

- Add an activity selector that merges jobs and audit logs into a readable timeline. Technical details stay in disclosures.

## Global Implementation Rules

- Use visible label `SyncBay`, never `SyncBay Catalog Bridge`.
- Use real SyncBay logo assets from `brand/assets/` or an inline component derived from approved SVG content.
- Keep product surface in Italian.
- Keep code identifiers in English where consistent with the repo.
- Prefer Shopify/App Bridge/web components already in the app. Add no new dependency unless a concrete missing primitive blocks implementation.
- Do not introduce `@shopify/polaris` React components for this redesign.
- Keep every technical detail sanitized: no secrets, raw payloads, customer data or real merchant data in logs, screenshots, docs or fixtures.
- Cards are allowed for functional panels, repeated items, conflicts and modals. Do not nest cards.
- Keep table rows compact and scan-friendly.
- No purple, no dominant gradients, no decorative orbs, no marketing hero.
- Use eBay/Shopify logos only as small connection/source/destination indicators when legally and visually appropriate.

## Task 1: Pure UI State Helpers

**Files:**

- Create: `app/lib/syncbay-ui-state.ts`
- Create: `app/lib/syncbay-ui-state.test.ts`

- [ ] **Step 1: Add tests for next-action priority**

Create tests that cover this exact priority order:

1. `Collegamento eBay mancante o scaduto`
2. `Quantità da verificare`
3. `Conflitti aperti`
4. `Aggiornamento catalogo in ritardo`
5. `Importazione incompleta`
6. `Impostazioni mancanti`
7. `Tutto sotto controllo`

Run:

```bash
npm run test:lib
```

Expected before implementation: the new test fails because `app/lib/syncbay-ui-state.ts` does not exist.

- [ ] **Step 2: Implement the helper**

Implement a pure helper that accepts already-loaded dashboard flags and returns:

- `kind`
- `title`
- `body`
- `tone`
- `primaryActionLabel`
- `primaryActionHref`

Required labels:

- `Collegamento eBay mancante o scaduto`
- `Quantità da verificare`
- `Conflitti aperti`
- `Aggiornamento catalogo in ritardo`
- `Importazione incompleta`
- `Impostazioni mancanti`
- `Tutto sotto controllo`

- [ ] **Step 3: Add label helpers**

Add pure helpers for:

- conflict action labels:
  - `REALIGN_FROM_EBAY` -> `Usa valore eBay`
  - `KEEP_SHOPIFY` -> `Mantieni Shopify`
  - `IGNORE_FIELD` -> `Ignora campo`
- catalog status labels:
  - active and fresh -> `Aggiornato`
  - open conflict -> `Conflitto`
  - failed job or mapping error -> `Errore`
  - stale sync -> `Da controllare`
  - archived mapping -> `Archiviato`
- timeline categories:
  - import jobs -> `Importazioni`
  - incremental sync jobs -> `Aggiornamenti`
  - Shopify paid-order stock jobs -> `Disponibilità`
  - conflict events -> `Conflitti`
  - failed/retrying jobs -> `Errori`

- [ ] **Step 4: Run tests**

Run:

```bash
npm run test:lib
```

Expected: PASS.

## Task 2: Embedded Shell And Navigation

**Files:**

- Modify: `app/routes/app.tsx`

- [ ] **Step 1: Add App Bridge nav**

Use `NavMenu` from `@shopify/app-bridge-react`, which is already present in `node_modules/@shopify/app-bridge-react`.

Navigation order:

```text
/app                Panoramica
/app/catalog        Catalogo
/app/conflicts      Conflitti
/app/import-preview Importazione
/app/activity       Attività
/app/settings       Impostazioni
```

The home link should represent `Panoramica`. Do not add `Dashboard`, `Account` or `Diagnostica`.

- [ ] **Step 2: Keep route auth unchanged**

Keep the current `authenticate.admin(request)` in `app/routes/app.tsx`. Do not move auth into child route components.

- [ ] **Step 3: Verify typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS. If `NavMenu` import type fails, inspect the installed package API before adding any dependency.

## Task 3: Shared Visual System

**Files:**

- Modify: `app/root.tsx`
- Create: `app/styles/syncbay-embedded.css`

- [ ] **Step 1: Add stylesheet wiring**

Add a React Router `links` export in `app/root.tsx` for the shared embedded stylesheet.

The stylesheet must be app-owned, not loaded from external design experiments or concept PNGs.

- [ ] **Step 2: Define tokens from `BRAND.md`**

Use these tokens:

```css
:root {
  --syncbay-cloud: #f6f8f7;
  --syncbay-paper: #ffffff;
  --syncbay-ink: #15202b;
  --syncbay-slate: #51615f;
  --syncbay-mist: #d8e0dd;
  --syncbay-harbor: #0f5e6e;
  --syncbay-current: #1a8f7a;
  --syncbay-moss: #3f7d4a;
  --syncbay-amber: #b7791f;
  --syncbay-coral: #c75c48;
  --syncbay-steel: #3d6f9f;
}
```

Do not add purple or new accent colors.

- [ ] **Step 3: Add shared classes**

Add classes for:

- page intro and action strip;
- compact metric row;
- product table with thumbnail column;
- single operational status badge;
- conflict comparison block;
- activity timeline;
- settings vertical stack;
- technical details disclosure.

- [ ] **Step 4: Verify no visual anti-patterns**

Search after implementation:

```bash
rg -n "purple|violet|gradient|Esporta|Sincronizza tutto|Dashboard|Account|Diagnostica" app/routes app/styles
```

Expected:

- no purple/violet/gradient styling;
- no visible `Esporta`;
- no broad visible `Sincronizza tutto`;
- `Dashboard`, `Account` and `Diagnostica` only appear in technical or legacy text when intentionally retained outside primary nav.

## Task 4: Panoramica

**Files:**

- Modify: `app/routes/app._index.tsx`
- Modify if needed: `app/services/syncbay.server.ts`

- [ ] **Step 1: Keep loader data source**

Start from `getDashboardState(session)`. Add service fields only if the route needs a signal that cannot be derived from the current return shape.

The next-action helper must use this priority:

1. `Collegamento eBay mancante o scaduto`
2. `Quantità da verificare`
3. `Conflitti aperti`
4. `Aggiornamento catalogo in ritardo`
5. `Importazione incompleta`
6. `Impostazioni mancanti`
7. `Tutto sotto controllo`

- [ ] **Step 2: Rebuild page order**

Render in this order:

1. next action/status panel;
2. compact metrics:
   - prodotti collegati;
   - conflitti aperti;
   - quantità da verificare;
   - ultimo aggiornamento catalogo;
3. recommended actions;
4. catalog health;
5. connection status, especially eBay connection state;
6. recent activity preview;
7. collapsed diagnostics.

- [ ] **Step 3: Move technical copy out of the primary layer**

Do not lead with:

- `Scope richiesti`;
- `Scope mancanti`;
- `Webhook pilota`;
- raw job statuses;
- provider internals.

Put those in a disclosure or link to `Attività`.

- [ ] **Step 4: Preserve actions**

From the current home, preserve or relocate:

- `Collega/Ricollega eBay` -> action card when eBay is missing, or `Importazione`;
- `Apri preview import` -> `Importazione`;
- `Apri impostazioni` -> `Impostazioni`;
- retry failed jobs -> `Attività`.

- [ ] **Step 5: Verify copy guardrails**

Search:

```bash
rg -n "Disponibilità non protetta|Esporta|SyncBay Catalog Bridge|job|OAuth|scope|payload" app/routes/app._index.tsx
```

Expected:

- no `Disponibilità non protetta`;
- no `Esporta`;
- no `SyncBay Catalog Bridge`;
- technical words appear only in diagnostics or code identifiers, not primary customer copy.

## Task 5: Catalogo

**Files:**

- Create: `app/routes/app.catalog.tsx`
- Modify: `app/services/syncbay.server.ts`

- [ ] **Step 1: Add catalog page state**

Add a read function that returns active and archived `ProductMapping` rows for the shop, with the latest available `ProductSnapshot` data needed for:

- thumbnail if available from sanitized snapshot payload;
- title;
- SKU;
- eBay ItemID;
- Shopify product GID;
- quantity;
- price;
- last synced timestamp;
- mapping status;
- last error.

Do not introduce a schema migration for this task.

- [ ] **Step 2: Render table-first page**

Columns:

1. `Prodotto`
   - thumbnail;
   - title;
   - SKU/ItemID secondary line.
2. `Collegamento`
   - eBay item reference and Shopify link state.
3. `Disponibilità`
   - aligned, needs check, unknown or blocked.
4. `Prezzo`
   - display price/currency when available.
5. `Aggiornamento`
   - last sync freshness.
6. `Stato`
   - one computed badge only.
7. `Azione`
   - `Dettagli`, `Risolvi`, `Riprova` when applicable.

- [ ] **Step 3: Add catalog filters**

Filters:

- `Tutti`
- `Collegati`
- `Aggiornati`
- `Da controllare`
- `Conflitti`
- `Non aggiornati`
- `Archiviati`

Do not include import filters such as `Pronti da importare` on this page.

- [ ] **Step 4: Remove bidirectional visual metaphors**

Do not use arrows between eBay and Shopify. Use text such as:

```text
Collegato a eBay
Origine catalogo: eBay
Prodotto Shopify collegato
```

- [ ] **Step 5: Verify table density**

Browser QA must compare the page to `docs/assets/ui-concepts/2026-06-03/02-catalogo.png` and check:

- rows are compact;
- page is table-first;
- first column has thumbnail + title;
- `Archiviati` is neutral, not purple;
- one primary `Stato` badge exists.

## Task 6: Conflitti

**Files:**

- Create: `app/routes/app.conflicts.tsx`
- Modify: `app/services/syncbay.server.ts`

- [ ] **Step 1: Add conflicts page state**

Return open and recently resolved conflicts with:

- product title/thumbnail when available;
- eBay ItemID;
- field;
- Shopify value;
- eBay/SyncBay value;
- impact text;
- detected/resolved timestamp;
- status.

- [ ] **Step 2: Reuse existing conflict action**

Reuse `resolveSyncConflict(session, { conflictId, resolution })`.

Map visible buttons:

- `Usa valore eBay` -> `REALIGN_FROM_EBAY`
- `Mantieni Shopify` -> `KEEP_SHOPIFY`
- `Ignora campo` -> `IGNORE_FIELD`

Do not show enum names in primary UI.

- [ ] **Step 3: Default to open conflicts**

Filters:

- `Aperti`
- `Risolti`
- `Tutti`

Default: `Aperti`.

- [ ] **Step 4: Show decision anatomy**

Each row/card must show:

- product;
- field;
- difference;
- impact;
- action.

Resolved history is secondary and must not visually compete with open conflicts.

- [ ] **Step 5: Verify action copy**

Search:

```bash
rg -n "REALIGN_FROM_EBAY|KEEP_SHOPIFY|IGNORE_FIELD|Mantieni modifica Shopify" app/routes/app.conflicts.tsx
```

Expected:

- enum values only as form values or mapping code;
- visible copy uses `Usa valore eBay`, `Mantieni Shopify`, `Ignora campo`.

## Task 7: Importazione

**Files:**

- Modify: `app/routes/app.import-preview.tsx`

- [ ] **Step 1: Keep existing actions**

Preserve:

- save default Shopify location;
- rename location;
- create/start catalog import jobs;
- preview/dry-run blockers;
- live eBay preview when connected;
- mock preview fallback when not connected.

- [ ] **Step 2: Reframe the route**

Visible page heading: `Importazione`.

Steps:

1. `Collegamento eBay`
2. `Preparazione Shopify`
3. `Anteprima catalogo`
4. `Importazione`
5. `Dopo l'import`

- [ ] **Step 3: Keep import filters separate**

Filters for preview/import areas:

- `Tutti`
- `Pronti da importare`
- `Importazione in corso`
- `Già importati`
- `Da reimportare`
- `Errore`

- [ ] **Step 4: Show settings summary only**

Show summary for:

- default product status: `Bozza` or `Attivo`;
- publication channel policy;
- selected channels.

The full configuration remains in `Impostazioni`.

- [ ] **Step 5: Preserve shortcuts**

Provide links:

- `Modifica impostazioni` -> `/app/settings`;
- `Vai al catalogo` -> `/app/catalog` after import state is usable.

## Task 8: Attività

**Files:**

- Create: `app/routes/app.activity.tsx`
- Modify: `app/services/syncbay.server.ts`

- [ ] **Step 1: Add activity page state**

Use existing sources:

- recent `SyncJob`;
- recent import jobs;
- `AuditLog`;
- failed/retrying jobs;
- conflict events where useful.

No new queue or provider integration.

- [ ] **Step 2: Render timeline first**

Each event shows:

- what happened;
- when;
- affected count when available;
- result;
- safe next action when available.

Example visible copy:

```text
958 prodotti sincronizzati correttamente.
12 prodotti messi in attesa per conflitto.
Quantità aggiornata dopo ordine Shopify.
eBay non ha risposto, SyncBay riproverà automaticamente.
```

- [ ] **Step 3: Add filters**

Filters:

- `Tutte`
- `Importazioni`
- `Aggiornamenti`
- `Disponibilità`
- `Conflitti`
- `Errori`

- [ ] **Step 4: Move diagnostics into details**

Technical details can include:

- job id;
- job type;
- attempts;
- sanitized error code;
- sanitized payload summary.

They must be hidden behind disclosure/details by default.

- [ ] **Step 5: Reuse retry behavior**

Failed retryable jobs should use `requestSyncJobRetry`.

Do not add a broad `Sincronizza tutto` button.

## Task 9: Impostazioni

**Files:**

- Modify: `app/routes/app.settings.tsx`

- [ ] **Step 1: Preserve existing settings actions**

Preserve:

- `Salva sync catalogo`;
- `Salva stato prodotto default`;
- `Salva canali`;
- available Shopify publication channel selection;
- sync enablement blockers;
- target sync display;
- active mapping count.

- [ ] **Step 2: Render four vertical boxes**

Boxes, in this order:

1. `Sync catalogo`
2. `Import prodotti`
3. `Canali di vendita`
4. `Avanzate`

Use a single-column stack on desktop and mobile. Do not use a four-column row.

- [ ] **Step 3: Place eBay account in Avanzate**

Inside `Avanzate`, include:

- eBay connection state;
- `Collega eBay` / `Ricollega eBay` link when available;
- links to diagnostics/activity;
- Shopify scope/webhook details if retained.

Do not add a fifth `Account` box unless the maintainer explicitly reverses the four-box decision.

- [ ] **Step 4: Keep advanced technical details below**

Move or keep low-priority technical details under advanced disclosure:

- Shopify scopes;
- webhook topics;
- endpoint/account deletion status;
- runtime/provider readiness.

## Task 10: Smoke Checks And Existing Script

**Files:**

- Modify: `scripts/smoke-ui.mjs`

- [ ] **Step 1: Update file-content smoke checks**

Add route checks for:

- `app/routes/app._index.tsx`: `Panoramica`, `Collegamento eBay mancante`, `Quantità da verificare`, `Tutto sotto controllo`.
- `app/routes/app.catalog.tsx`: `Catalogo`, `Prodotto`, `Collegamento`, `Disponibilità`, `Stato`.
- `app/routes/app.conflicts.tsx`: `Conflitti`, `Usa valore eBay`, `Mantieni Shopify`, `Ignora campo`.
- `app/routes/app.import-preview.tsx`: `Importazione`, `Collegamento eBay`, `Anteprima catalogo`, `Pianifica import catalogo`.
- `app/routes/app.activity.tsx`: `Attività`, `Importazioni`, `Aggiornamenti`, `Disponibilità`, `Errori`.
- `app/routes/app.settings.tsx`: `Sync catalogo`, `Import prodotti`, `Canali di vendita`, `Avanzate`.

- [ ] **Step 2: Run smoke check**

Run:

```bash
npm run smoke:ui
```

Expected: PASS.

## Task 11: Local Gates

**Files:**

- Read: `package.json`
- Read: `docs/TOOLCHAIN.md`

- [ ] **Step 1: Run docs/code formatting gate**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 2: Run pure tests**

Run:

```bash
npm run test:lib
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript and lint**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Run React Doctor when the route/component split is complete**

Run:

```bash
npm run quality:react-doctor
```

Expected: no errors. If it reports warnings only, review whether they are actionable before closing.

## Task 12: Browser And Visual QA

**Files:**

- Reference: `docs/assets/ui-concepts/2026-06-03/01-panoramica.png`
- Reference: `docs/assets/ui-concepts/2026-06-03/02-catalogo.png`
- Reference: `docs/assets/ui-concepts/2026-06-03/03-conflitti.png`
- Reference: `docs/assets/ui-concepts/2026-06-03/04-importazione.png`
- Reference: `docs/assets/ui-concepts/2026-06-03/05-attivita.png`
- Reference: `docs/assets/ui-concepts/2026-06-03/06-impostazioni.png`

- [ ] **Step 1: Start local app**

Use the repo's normal dev command:

```bash
npm run dev
```

If Shopify CLI auth or tunnel state blocks local rendering, report the blocker and use the strongest available static/build verification instead of claiming browser QA passed.

- [ ] **Step 2: Verify desktop pages**

Open:

- `/app`
- `/app/catalog`
- `/app/conflicts`
- `/app/import-preview`
- `/app/activity`
- `/app/settings`

Check against the corresponding concept image:

- nav label and order;
- first visual hierarchy;
- density;
- table/list anatomy;
- visible copy;
- accent colors;
- no text overflow;
- no nested-card clutter;
- no export/bidirectional sync language.

- [ ] **Step 3: Verify narrow viewport**

Use a narrow viewport around 375px width.

Pass conditions:

- nav remains usable in Shopify embedded context;
- buttons do not overflow;
- table rows collapse or scroll predictably;
- settings boxes remain stacked;
- long Italian labels remain readable.

- [ ] **Step 4: Use image comparison inspection**

Use `view_image` on each concept PNG and on latest browser screenshots before final handoff.

Record at least five comparison points:

- copy;
- layout;
- density;
- color;
- table/timeline/form anatomy;
- technical-details placement;
- responsive behavior.

## Task 13: Documentation And Release Classification

**Files:**

- Modify after implementation: `docs/guides/ui-concepts-handoff.md`
- Modify if visible runtime behavior changes: `CHANGELOG.md`
- Read: `docs/guides/versioning-e-release.md`
- Read: `docs/guides/git-e-pubblicazione.md`

- [ ] **Step 1: Update handoff after implementation**

Record:

- implemented pages;
- intentional deviations from concept images;
- data-contract deviations from Phase 0;
- visual QA evidence;
- known risks;
- any functions intentionally removed or moved.

- [ ] **Step 2: Classify versioning**

If the implementation changes user-visible runtime UI, classify the diff before publication:

- likely `PATCH` for compatible UI/copy improvement;
- `MINOR` only if it introduces a clearly new user-facing workflow.

Do not run `npm run release` unless `CHANGELOG.md` has versioned unreleased entries or AGENTS release rules require it for the actual publication flow.

- [ ] **Step 3: Before PR/merge/publish**

If the work is published via PR or merge, check the `Codex feedback inbox` according to `AGENTS.md`, then run the chosen verification lane.

## Rollback

The UI redesign should be rollbackable without provider or database changes.

Rollback strategy:

- revert route/component/CSS changes;
- keep Prisma schema untouched;
- keep provider env untouched;
- keep docs assets and handoff unless the maintainer asks to remove the design archive.

If a route-specific loader accidentally changes data behavior, stop and split that change into a separate bugfix before continuing visual work.

## Final Acceptance Checklist

- [ ] Phase 0 data contracts are documented before runtime UI edits.
- [ ] Concept images are used as directional references, not pixel-perfect specs.
- [ ] Six nav items in the approved order.
- [ ] No `Dashboard`, `Account` or `Diagnostica` as primary nav labels.
- [ ] Panoramica opens with next action or `Tutto sotto controllo`.
- [ ] If eBay is missing or expired, Panoramica makes that the first next action.
- [ ] Catalogo is table-first, compact, with thumbnail + title and one `Stato` column.
- [ ] Import filters and Catalogo filters are separate.
- [ ] Conflitti defaults to open conflicts and uses approved action labels.
- [ ] Importazione is one step-based page and preserves current import/location actions.
- [ ] Attività is a readable timeline with diagnostics secondary.
- [ ] Impostazioni has four vertical boxes: `Sync catalogo`, `Import prodotti`, `Canali di vendita`, `Avanzate`.
- [ ] Account eBay is inside `Importazione` and `Impostazioni > Avanzate`, not primary nav.
- [ ] Existing actions are preserved or explicitly documented as moved/removed.
- [ ] New pages use real loaders/selectors or explicit empty states, not static mock screens.
- [ ] No export or bidirectional catalog-sync visual language.
- [ ] Uses real SyncBay logo asset in implementation.
- [ ] Uses only SyncBay brand palette and semantic colors.
- [ ] `npm run test:lib`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run smoke:ui` pass or failures are documented with impact.
- [ ] Browser visual QA compares all six implemented pages against the six concept PNGs.

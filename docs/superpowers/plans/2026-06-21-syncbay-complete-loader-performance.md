# SyncBay Loader Performance Implementation Plan

**Goal:** Ridurre il tempo reale e percepito di apertura delle 6 pagine embedded SyncBay, usando le misure production come fonte di verità.

**Architecture:** La correzione va fatta per route, non come refactor generico. Importazione deve smettere di bloccare l'apertura pagina sulla preview live eBay; Panoramica e Attività devono smettere di condividere sempre il loader dashboard completo; Catalogo riceve solo ottimizzazioni mirate dopo i due colli di bottiglia maggiori. La strumentazione `syncbay-loader-performance` resta il contratto di verifica.

**Tech Stack:** React Router loaders/actions, Shopify embedded app, Prisma/Supabase Postgres, Shopify Admin GraphQL, eBay Inventory/Trading API, Vercel production `fra1`.

---

## Baseline Production

Misura del 2026-06-21 su `syncbay.vercel.app`, deployment `dpl_6aaQnmWez2sDBJAU9vJP8B3s4ods`, regione `fra1`.

| Priorità | Route        |    Totale | Stage dominante                            |
| -------- | ------------ | --------: | ------------------------------------------ |
| 1        | Importazione | 5339.7 ms | `import.ebay.preview` 4105.6 ms            |
| 2        | Panoramica   | 2440.4 ms | `dashboard.db.mainTransaction` 1244.7 ms   |
| 3        | Attività     | 1862.3 ms | `dashboard.db.mainTransaction` 1133.6 ms   |
| 4        | Catalogo     | 1133.4 ms | `catalog.db.summaryCounts` 511.9 ms        |
| 5        | Conflitti    |  829.0 ms | `conflicts.db.summaryTransaction` 276.1 ms |
| 6        | Impostazioni |  815.6 ms | `settings.db.stateTransaction` 282.8 ms    |

## Definition of Done

- Ogni giro produce una PR autonoma, release locale se `CHANGELOG.md` contiene sezioni versionate, merge su `main`, deploy Vercel production e pulizia branch/worktree.
- Ogni giro confronta le 6 route con `vercel logs syncbay.vercel.app --query syncbay-loader-performance --json`.
- La verifica browser usa Safari nell'admin Shopify reale; Chrome/Computer Use è fallback solo se Safari non è automatizzabile.
- Nessun giro introduce worker dedicati o nuovo runtime.
- Nessun log espone payload eBay/Shopify sensibile; si riportano solo route, tempi, byte e nomi stage.

## File Map

- `app/routes/app.import-preview.tsx`: loader/action di Importazione, separazione apertura pagina da refresh preview live.
- `app/services/syncbay.server.ts`: `getImportWizardState`, `getDashboardState`, nuove funzioni leggere per Panoramica/Attività.
- `app/services/ebay-inventory-preview.server.ts`: path live eBay da non chiamare nel loader iniziale se la pagina non richiede refresh.
- `app/services/import-preview.server.ts`: shape `ImportPreviewResult` e helper pure per preview vuota/cached/deferred.
- `app/lib/syncbay-loader-performance.ts`: metrica esistente, da estendere solo se servono nuovi label stabili.
- `app/lib/*.test.ts`: test pure per mode, payload e riepiloghi.
- `prisma/schema.prisma`: solo se si decide di persistere una cache preview; evitarlo nel primo giro se basta deferire.
- `CHANGELOG.md` e `app/lib/version.ts`: release locale per ogni patch runtime pubblicata.

## Giro 3: Importazione Senza Preview Live Bloccante

**Obiettivo:** Portare l'apertura di Importazione sotto 1500 ms. La preview live eBay può restare lenta, ma deve diventare refresh esplicito o caricamento successivo, non costo obbligatorio della navigazione.

**Files:**

- Modify: `app/routes/app.import-preview.tsx`
- Modify: `app/services/syncbay.server.ts`
- Modify: `app/services/import-preview.server.ts`
- Test: `app/lib/syncbay-import-preview-stepper.test.ts` oppure nuovo `app/lib/syncbay-import-preview-mode.test.ts`

- [ ] **Step 1: aggiungere un helper pure per la modalità preview**

  Creare `app/lib/syncbay-import-preview-mode.ts`:

  ```ts
  export type ImportPreviewLoadMode = "deferred" | "live";

  export function normalizeImportPreviewLoadMode(
    value: FormDataEntryValue | string | null | undefined,
  ): ImportPreviewLoadMode {
    return value === "live" ? "live" : "deferred";
  }
  ```

- [ ] **Step 2: testare il default deferred**

  Creare `app/lib/syncbay-import-preview-mode.test.ts`:

  ```ts
  import assert from "node:assert/strict";
  import test from "node:test";
  import { normalizeImportPreviewLoadMode } from "./syncbay-import-preview-mode.ts";

  test("defaults import preview loading to deferred", () => {
    assert.equal(normalizeImportPreviewLoadMode(null), "deferred");
    assert.equal(normalizeImportPreviewLoadMode(""), "deferred");
    assert.equal(normalizeImportPreviewLoadMode("mock"), "deferred");
  });

  test("accepts explicit live preview loading", () => {
    assert.equal(normalizeImportPreviewLoadMode("live"), "live");
  });
  ```

- [ ] **Step 3: rendere `getImportWizardState` parametrico**

  In `app/services/syncbay.server.ts`, cambiare la firma:

  ```ts
  export async function getImportWizardState(
    session: ShopifySessionLike,
    admin?: ShopifyAdminGraphqlClient,
    trace?: SyncBayLoaderPerformanceTrace,
    options: { previewLoadMode?: "deferred" | "live" } = {},
  );
  ```

  Regola:
  - `live`: comportamento attuale, chiama `getEbayLiveImportPreview`.
  - `deferred`: non chiama eBay, ritorna una preview vuota/live-deferred con messaggio operativo e `draftImport.enabled === false`.

- [ ] **Step 4: aggiornare il loader Importazione**

  In `app/routes/app.import-preview.tsx`, il loader usa:

  ```ts
  getImportWizardState(session, admin, trace, { previewLoadMode: "deferred" });
  ```

  L'action che avvia import o refresh live deve usare:

  ```ts
  getImportWizardState(session, admin, undefined, { previewLoadMode: "live" });
  ```

- [ ] **Step 5: mantenere esplicita la UI**

  La pagina deve mostrare stato operativo chiaro: preview non ancora aggiornata, azione primaria per generare/aggiornare preview live, import disabilitato finché non esiste preview live importabile.

- [ ] **Step 6: verifiche**

  Run:

  ```bash
  npm run typecheck
  npm run lint
  npm run test:lib
  npm run build
  npm run release:dry-run
  git diff --check
  ```

- [ ] **Step 7: publish e misura**

  Pubblicare con PR secondo `AGENTS.md`, poi misurare tutte le 6 route. Target:
  - Importazione initial load sotto 1500 ms.
  - `import.ebay.preview` assente dal loader iniziale.
  - Refresh live ancora tracciato separatamente quando richiesto.

## Giro 4: Split Panoramica e Attività

**Obiettivo:** Panoramica e Attività non devono pagare entrambe il dashboard completo. Target: Panoramica sotto 1200 ms, Attività sotto 1000 ms.

**Files:**

- Modify: `app/routes/app._index.tsx`
- Modify: `app/routes/app.activity.tsx`
- Modify: `app/services/syncbay.server.ts`
- Test: `app/lib/syncbay-overview-state.test.ts` se si estraggono helper pure

- [ ] **Step 1: creare due funzioni servizio esplicite**

  In `app/services/syncbay.server.ts`:

  ```ts
  export async function getOverviewState(
    session: ShopifySessionLike,
    trace?: SyncBayLoaderPerformanceTrace,
  ) {
    return getDashboardState(session, trace);
  }

  export async function getActivityState(
    session: ShopifySessionLike,
    trace?: SyncBayLoaderPerformanceTrace,
  ) {
    return getDashboardState(session, trace);
  }
  ```

  Primo commit solo meccanico, senza cambio comportamento. Serve a separare le route prima di alleggerirle.

- [ ] **Step 2: spostare Panoramica su `getOverviewState`**

  In `app/routes/app._index.tsx`, sostituire `getDashboardState(session, trace)` con `getOverviewState(session, trace)`.

- [ ] **Step 3: spostare Attività su `getActivityState`**

  In `app/routes/app.activity.tsx`, sostituire `getDashboardState(session, trace)` con `getActivityState(session, trace)`.

- [ ] **Step 4: alleggerire Attività**

  `getActivityState` deve caricare solo:
  - ultimi job;
  - audit log;
  - conteggio conflitti aperti;
  - stato retry/backoff necessario alla pagina.

  Non deve caricare:
  - `catalogSummaryCounts`;
  - import run summary completo;
  - readiness/settings che sono usate solo da Panoramica.

- [ ] **Step 5: alleggerire Panoramica**

  `getOverviewState` deve caricare solo i dati visibili in Panoramica. Se la pagina mostra un numero ma non una tabella, usare `count` o query aggregate, non `findMany` con payload ricco.

- [ ] **Step 6: verifiche**

  Run:

  ```bash
  npm run typecheck
  npm run lint
  npm run test:lib
  npm run build
  npm run release:dry-run
  git diff --check
  ```

- [ ] **Step 7: publish e misura**

  Dopo deploy production, confrontare:
  - `dashboard.db.mainTransaction`;
  - `overview.state`;
  - `activity.state`;
  - `payloadBytes`.

## Giro 5: Catalogo Seconda Ottimizzazione Mirata

**Obiettivo:** Portare Catalogo sotto 900 ms stabile, senza sacrificare completezza dei conteggi.

**Files:**

- Modify: `app/services/syncbay.server.ts`
- Test: test esistenti su catalog filters/pagination/summary

- [ ] **Step 1: separare conteggi critici da conteggi decorativi**

  Identificare in `getCatalogSummaryCounts` quali conteggi servono per stato operativo immediato e quali possono essere differiti o letti dal summary dashboard.

- [ ] **Step 2: evitare roundtrip duplicati**

  Se `totalAvailableCount` e `summaryCounts` leggono la stessa popolazione, consolidare query o passare il totale già calcolato.

- [ ] **Step 3: mantenere thumbnail cache come path primario**

  Il campione migliore ha `catalog.shopify.thumbnails: 0.1 ms`; non reintrodurre query Shopify sincrone per righe già coperte da cache/snapshot.

- [ ] **Step 4: verifiche e misura**

  Stessi gate standard. Target:
  - `catalog.db.summaryCounts` sotto 300 ms;
  - `catalog.state` sotto 800 ms;
  - pagina sotto 900 ms.

## Giro 6: Conflitti e Impostazioni

**Obiettivo:** Portare entrambe sotto 700 ms se il costo è basso; non farle precedere i colli maggiori.

**Files:**

- Modify: `app/routes/app.conflicts.tsx`
- Modify: `app/routes/app.settings.tsx`
- Modify: `app/services/syncbay.server.ts`

- [ ] **Step 1: Conflitti**

  Verificare se `conflicts.db.summaryTransaction` fa conteggi non visibili nella vista filtrata. Se sì, dividerli tra summary minimo e dettaglio pagina.

- [ ] **Step 2: Impostazioni**

  Verificare se `settings.shopify.publications` può usare cache breve o essere richiamata solo quando la sezione pubblicazioni è visibile/necessaria.

- [ ] **Step 3: non ottimizzare se il guadagno è marginale**

  Se dopo Giro 3-5 queste route restano sotto 850 ms e Safari risulta fluido, lasciare il lavoro in backlog invece di aggiungere complessità.

## Giro 7: Navigazione Percepita e Shell Embedded

**Obiettivo:** Anche quando il server impiega 1-2 secondi, Safari deve dare feedback immediato e coerente.

**Files:**

- Modify: `app/routes/app.tsx`
- Modify: `app/styles/syncbay-embedded.css`
- Test: `npm run smoke:ui`

- [ ] **Step 1: verificare lo stato attuale `useNavigation`**

  Confermare che il pending route sia ancora collegato a `navigation.location.pathname` e non a timeout manuali.

- [ ] **Step 2: evitare overlay invasivi**

  Mantenere indicatore leggero nella shell; non coprire la pagina con loader globale perché Shopify Admin aggiorna URL/sidebar prima dell'iframe.

- [ ] **Step 3: Safari QA**

  Aprire una sequenza completa:
  Panoramica -> Importazione -> Attività -> Catalogo -> Conflitti -> Impostazioni.

  Accettazione: entro 100-200 ms deve apparire feedback di navigazione, anche se il loader server continua.

## Giro 8: Guardrail Permanente di Misura

**Obiettivo:** Evitare regressioni future sulle 6 pagine.

**Files:**

- Create: `scripts/measure-loader-performance.mjs`
- Modify: `package.json`
- Modify: `docs/TOOLCHAIN.md`

- [ ] **Step 1: script di raccolta log**

  Creare uno script che legge `vercel logs`, estrae `[syncbay-loader-performance]`, raggruppa per route e stampa tabella ordinata.

- [ ] **Step 2: package script**

  Aggiungere:

  ```json
  {
    "scripts": {
      "perf:loaders": "node scripts/measure-loader-performance.mjs"
    }
  }
  ```

- [ ] **Step 3: documentare la procedura**

  In `docs/TOOLCHAIN.md`, aggiungere la procedura: aprire le 6 route in Safari, poi eseguire `npm run perf:loaders -- --since 10m`.

## Ordine Consigliato

1. Giro 3: Importazione deferred/live explicit.
2. Giro 4: split Panoramica/Attività.
3. Giro 5: Catalogo seconda ottimizzazione.
4. Giro 6: Conflitti/Impostazioni solo se ancora rilevanti.
5. Giro 7: navigazione percepita, dopo aver ridotto i loader peggiori.
6. Giro 8: guardrail permanente.

## Rischi

- Se Importazione perde la preview live iniziale senza microcopy chiara, l'utente può pensare che l'import sia rotto. Mitigazione: stato esplicito e azione primaria "Aggiorna preview live".
- Se si introduce cache persistente preview troppo presto, si aggiunge schema e retention prima di sapere se il defer basta. Mitigazione: primo giro senza nuova tabella.
- Se Panoramica e Attività vengono separate in un unico commit grande, è più difficile capire quale query migliora o rompe. Mitigazione: prima commit meccanico, poi alleggerimento.
- Se si misura solo Catalogo, si torna al bias precedente. Mitigazione: ogni PR deve misurare tutte le 6 route.

## Gate di Pubblicazione per Ogni Giro

```bash
npm run typecheck
npm run lint
npm run test:lib
npm run build
npm run release:dry-run
git diff --check
npm run publish:preflight -- --remote
gh pr checks <PR> --watch --interval 10
```

Dopo merge:

```bash
vercel inspect syncbay.vercel.app
vercel logs syncbay.vercel.app --since 10m --query syncbay-loader-performance --json
```

# SyncBay Comprehensive Improvement Implementation Plan

**Goal:** Eliminare tutti i rilievi validati nella revisione generale di SyncBay: backlog e freschezza conflitti, sicurezza sessioni Shopify, pressione database, retry e transazioni Shopify Admin, doppio ciclo vita import, locality del catalogo esistente, copertura dei moduli runtime, falso verde UI, stati negoziante coerenti, accessibilità e stati degradati, impaginazione e raccolte di box bilanciate senza spazi vuoti, overflow del catalogo, osservabilità e payload frontend, pulizia generale, budget Vercel/Supabase Free, drift documentale e piccoli debiti verificati.

**Architecture:** Il lavoro approfondisce cinque moduli dentro il runtime esistente: intake/rilevamento conflitti, adapter Shopify Admin/sessioni, storia prodotto, esecuzione import e takeover catalogo esistente. Le modifiche dati seguono rollout additivi e compatibili prima di qualunque compattazione; Supabase Cron, Vercel Functions e Prisma restano l'unico runtime asincrono, senza nuovi worker o code esterne.

**Tech Stack:** Node.js 24.18.0, npm 11.x (11.16.0 nella verifica locale), TypeScript 6, React Router 7, React 19, Shopify Admin GraphQL 2026-07, Prisma 7.8, Supabase Postgres/Cron, Vercel, Polaris Web Components, Node test runner + `tsx` per i moduli server.

**Stato:** Completato il 16 luglio 2026: Task 1-13 chiusi e pubblicati, con le esclusioni e le rinunce esplicite del maintainer registrate nei rispettivi task.

## Global Constraints

- eBay resta la sorgente di verità del catalogo; l'unica scrittura Shopify -> eBay resta la riduzione stock da `orders/paid`.
- I listing eBay inattivi restano prodotti Shopify esauriti; non cancellare né archiviare prodotti mappati.
- Non introdurre nuovi runtime, worker, queue provider, framework o `@shopify/polaris` React.
- Conservare il target configurabile 5-30 minuti e il limite 1.0 di 2.000 prodotti per shop.
- Mantenere il cron ogni 5 minuti e il limite live `2` durante l'intero programma; aumentare il throughput tramite coalescenza, batching e fairness, non alzando il limite senza una nuova misura e decisione.
- Ogni scrittura o migrazione live deve avere dry-run, conferma esplicita, conteggi senza payload e strategia di rollback.
- Non stampare token, segreti, dati cliente, titoli, SKU, descrizioni o payload reali nei log di migrazione/verifica.
- Scegliere caso per caso lo strumento provider più affidabile tra plugin, connector, MCP, app, CLI, API e browser; dichiarare soltanto limiti, risultati parziali o cambi di strumento che alterano la qualità delle prove.
- Ogni task runtime segue test-first: bug e nuove capacità partono da un test rosso; i refactor puri partono da test di caratterizzazione verdi, poi preservano il comportamento durante lo spostamento. Ogni task chiude con gate proporzionati e commit atomico.
- Le fixture restano sintetiche; nessun dato Numisleo o di altro negoziante entra nel repository.
- Le griglie che raggruppano box, card, metriche o pannelli di confronto usano una colonna sui contenitori mobile. Su desktop preservano il layout specifico della superficie: Impostazioni resta `2 x 2`; i cinque riepiloghi Conflitti restano sulla stessa riga quando lo spazio lo consente, senza forzare l'ultimo box a tutta larghezza. Non rendere il desktop monocolonna e non applicare regole globali a griglie interne di form, pulse o intestazioni.
- React Router 8, TypeScript 7 e tipi Node 26 restano migrazioni separate e fuori da questo piano.
- App Store, billing, multi-marketplace, multi-location avanzato, varianti complesse e rollback self-service per prodotto restano fuori dal programma: non erano difetti validati dell'audit e richiedono decisioni prodotto dedicate.
- Ogni ondata che modifica il runtime produce una release patch `1.0.x`, PR separata, deploy Vercel verificato e controllo del tick cron successivo prima di iniziare l'ondata seguente. Task e ondate esclusivamente documentali o di test restano non versionati quando il changelog non contiene cambi runtime.

## Baseline osservata da preservare e migliorare

Questi numeri sono la fotografia raccolta durante l'audit del 10 luglio 2026. Prima di ogni rollout vanno rilevati di nuovo: servono come confronto, non come valori correnti garantiti.

Riferimenti provider verificati il 10 luglio 2026: [Vercel Hobby](https://vercel.com/docs/plans/hobby), [limiti Vercel](https://vercel.com/docs/limits), [dimensione database Supabase](https://supabase.com/docs/guides/platform/database-size), [pricing Supabase](https://supabase.com/pricing) e [changelog Supabase](https://supabase.com/changelog). Versionare nel runbook la data di verifica, non copiare limiti come costanti eterne.

| Superficie | Baseline dell'audit | Uso nel piano |
| --- | --- | --- |
| Runner conflitti | `547` job `DETECT_SHOPIFY_CHANGES` dovuti; il più vecchio risale al 5 luglio; `0` conflitti aperti | Task 2 e 4 devono ridurre l'età sotto 15 minuti e separare conflitti, no-op e mapping mancanti |
| Esiti conflitti | Solo `20` esiti di conflitto su `6.445` job osservati, circa `0,31%`; prevalgono `mapping_not_found` e no-op | Task 4 deve batchare senza perdere la semantica di ogni esito |
| Inventory webhook | Nessun job inventory osservato nei 7 giorni analizzati; lookup limitato alle ultime `300` snapshot | Task 3 normalizza il GID e verifica la consegna su store pilota Numisleo |
| Database Supabase | Prima fotografia: circa `346 MB` su `500 MB`. Ricontrollo fresco del 10 luglio: `370.363.539` byte, circa `353,2 MiB`; `AuditLog` circa `144 MiB`, `ProductSnapshot` circa `123 MiB`, `SyncJob` circa `63,7 MiB`; negli ultimi 7 giorni `19.613` snapshot, `39.705` audit log e `11.291` job; `935` job attivi | Task 7, 8 e 13 introducono baseline/checkpoint, maintenance giornaliera, pruning cron e budget storage/egress |
| Sicurezza Supabase | Nessun advisor sicurezza; tre indici segnalati `unused` a livello informativo | Task 12 mantiene gli indici e richiede 30 giorni di statistiche prima di valutarli |
| Produzione Vercel | Deploy production `1.0.45`/commit `2962c11` `READY`. I log mostrano un incidente storico 4-5 luglio con `9.855` timeout di connessione, `6.541` timeout di avvio transazione, `818` session storage non pronto, `71` checkout pool, `3` deadlock e un timeout runner a `300 s`; i cluster non ricorrono dopo il 5 luglio. Restano `/robots.txt` `404` e `20` deploy preview/production in 7 giorni | Task 2/4 impongono budget temporale e concorrenza DB limitata; Task 12 corregge `robots.txt` e documenta budget Free; Task 13 richiede una finestra pulita post-rollout senza inventare un outage corrente |
| Gate locali | `585` test lib; coverage `95,36%` linee, `83,78%` branch, `96,51%` funzioni; typecheck, lint, build e audit production verdi. Esistono `3` file test server con `14` test, mentre circa `17` moduli server non hanno un test gemello diretto | Task 1 conserva i gate, include i `14` test server verificati con `tsx` e censisce il rischio; Task 4-10 aggiungono test ai moduli profondi toccati |
| UI e usabilità live | L'audit Computer Use in sola lettura sull'app embedded di Numisleo conferma: Impostazioni con card commerciali sbilanciate; Conflitti con cinque card troppo strette; Catalogo con 50 righe/8 colonne e overflow da confinare alla tabella; Attività con stato `Completata`/`Ok` ma testo “non ancora allineato” e valore “Non disponibile”; Importazione lunga, con `Ricollega eBay` e rinomina location troppo prominenti quando il collegamento è sano. Nessuna azione o scrittura è stata eseguita e nessun dato reale entra nelle fixture | Task 11 crea il render gate isolato; Task 12 corregge layout, semantica, densità e gerarchia; Task 13 ripete QA embedded read-only |
| Frontend e bundle | Build fresca: `149.035` byte gzip di JS client complessivo, route più grande Importazione circa `7,99 kB` gzip, CSS `3,34 kB` gzip, server bundle `181,9 kB` gzip; React Doctor `100/100` | Task 12 introduce un budget di regressione senza dipendenze e mantiene i valori con margine ragionevole |
| Accessibilità e stati UI | Esistono `aria-live`, `aria-busy`, riduzione movimento, paginazione e pending route, ma non un gate browser che provi hydration, tastiera, focus, zoom/reflow e stati degradati delle sei superfici | Task 11 aggiunge matrice fixture e browser check; Task 13 mantiene la verifica manuale tramite albero di accessibilità nativo, tastiera e zoom 400%, senza test screen reader |
| Osservabilità frontend/runtime | Speed Insights e Web Analytics sono già montati; i loader misurano durata e `payloadBytes`, ma i log sani sono emessi di default e manca una correlazione strutturata comune per runner/webhook | Task 12 riusa la telemetria esistente, aggiunge budget payload, sampling e `requestId` senza nuovi provider |
| Hotspot | `sync-job-runner.server.ts` circa `4.980` righe, `syncbay.server.ts` circa `4.950`, `shopify-draft-import.server.ts` circa `4.041`, `app.import-preview.tsx` circa `1.911` | Task 4, 6, 9 e 10 spostano ownership complete in moduli profondi; Task 13 verifica locality e dimensioni senza spezzare per sola metrica |
| GitHub e dipendenze | La base Git locale include la PR `#411`; major intenzionalmente rinviate: React Router 8, TypeScript 7 e tipi Node 26. Lo stato delle PR remote non viene assunto dal piano | Task 12 ricontrolla le dipendenze; Task 13 verifica GitHub live |

---

## Mappa unica: rilievi, architettura e task

| Rilievo validato | Candidato architetturale | Task |
| --- | --- | --- |
| Backlog `DETECT_SHOPIFY_CHANGES`, priorità fissa e conflitti non freschi | Modulo conflitti e fairness | 2, 4 |
| Lookup inventory limitato alle ultime 300 snapshot e assenza di segnali inventory recenti | Modulo conflitti e mapping stabile | 3, 4 |
| Token Shopify persistiti in chiaro | Adapter Shopify Admin/sessioni | 5, 6 |
| Refresh Shopify dentro `FOR UPDATE` e retry annidati fino a 4 x 4 | Adapter Shopify Admin/sessioni | 6 |
| `ProductSnapshot`, `AuditLog` e `SyncJob` dominano la size; cleanup eseguito a ogni tick | Storia prodotto profonda | 7, 8 |
| `cron.job_run_details` non viene ripulita automaticamente e conta circa `2.071` righe | Maintenance operativa giornaliera | 8 |
| Incidente storico di connection storm e runner arrivato a 300 secondi | Budget temporale runner e intake webhook limitato | 2, 4, 13 |
| Job import esterno + job interno con due cicli vita | Esecutore import profondo | 9 |
| Takeover distribuito tra route e servizi grandi; fixture `fieldPolicy` fuori contratto | Verticale catalogo esistente | 10, 11 |
| Coverage alta solo su `app/lib`; test server esistenti esclusi dalla CI | Fondazione di verifica | 1 |
| `smoke:ui` statico passa mentre il render reale fallisce e carica `.env` | Harness UI reale | 11 |
| Griglie di box possono lasciare buchi con quantità dispari | Regola condivisa: mobile monocolonna; desktop specifico per superficie, con Impostazioni `2 x 2` e cinque riepiloghi Conflitti sulla stessa riga quando lo spazio lo consente | 12, 13 |
| Stati live e metriche usano etichette contraddittorie o ambigue | Modello semantico UI condiviso e glossario metriche | 11, 12, 13 |
| Tabella Catalogo può trascinare l'intera app in overflow orizzontale | Contenitore scroll locale e layout con `min-inline-size: 0` | 12, 13 |
| Quota Free non governata oltre la sola size DB | Budget provider con soglie 70/85/95%, egress e build/deploy inclusi | 8, 12, 13 |
| Nessun gate browser/accessibilità sugli stati non-happy-path | Fixture state matrix, hydration e QA accessibilità | 11, 12, 13 |
| Log loader non campionati e senza correlazione comune | Logger strutturato e budget payload/log | 12, 13 |
| Controllo egress esistente rischiava di essere duplicato | `provider:budget` compone `egress:budget`, non lo sostituisce | 8, 13 |
| Warning React Doctor già risolto in `1.0.45`, `/robots.txt` 404, docs cron/roadmap incoerenti | Igiene finale e gate anti-regressione | 12 |
| Verifica release/deploy/provider e stabilità post-fix | Chiusura programma | 13 |

## Ondate di consegna

1. **Ondata A — Rete di sicurezza:** Task 1.
2. **Ondata B — Freschezza conflitti:** Task 2-4.
3. **Ondata C — Sessioni Shopify sicure:** Task 5-6, con due deploy separati per la migrazione token.
4. **Ondata D — Storia prodotto e storage:** Task 7-8, con dual-write prima della compattazione.
5. **Ondata E — Locality import e UI:** Task 9-11.
6. **Ondata F — Igiene, documentazione e chiusura:** Task 12-13.

---

### Task 1: Portare i test dei moduli server dentro il gate ufficiale

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/TOOLCHAIN.md`
- Verify: `app/services/ebay-trading-preview.server.test.ts`
- Verify: `app/services/shopify-existing-products.server.test.ts`
- Verify: `app/services/shopify-prisma-session-storage.server.test.ts`

**Interfaces:**
- Consumes: i test Node esistenti e la toolchain Node 24.
- Produces: `npm run test:services` e `npm run test:runtime`, usati da tutti i task successivi e dalla CI.

- [x] **Step 1: Registrare il rosso corrente del runner Node nativo**

Run:

```bash
npm run prisma:generate
node --test --experimental-strip-types app/services/*.server.test.ts
```

Expected: `13` test passano e `ebay-trading-preview.server.test.ts` fallisce con `ERR_MODULE_NOT_FOUND` su un import TypeScript extensionless. Questo prova che i test server non possono essere aggiunti alla CI con il comando attuale.

- [x] **Step 2: Installare il runner TypeScript minimo verificato su Node 24**

Run:

```bash
npm install --save-dev --save-exact tsx@4.23.0
```

Expected: installazione senza `ERESOLVE`; `npm audit --omit=dev` resta con zero vulnerabilità production.

- [x] **Step 3: Aggiungere gli script ufficiali**

Inserire in `package.json`:

```json
"pretest:services": "npm run prisma:generate",
"test:services": "tsx --test app/services/*.server.test.ts",
"test:runtime": "npm run test:lib && npm run test:services"
```

Non sostituire `coverage:lib`: la soglia resta sui moduli puri, mentre `test:services` diventa un gate di contratto senza soglia artificiale iniziale.

- [x] **Step 4: Sostituire il gate parziale in CI**

In `.github/workflows/ci.yml`, sostituire lo step `Test librerie pure` con:

```yaml
- name: Test runtime
  run: npm run test:runtime
```

Mantenere lo step successivo `npm run coverage:lib`.

- [x] **Step 5: Verificare il nuovo gate**

Run:

```bash
npm run test:runtime
npm run coverage:lib
npm run typecheck
npm run lint
git diff --check
```

Expected: `585` test lib e `14` test server passano; coverage lib sopra `75%` linee e `65%` branch; typecheck/lint/diff-check verdi.

Censire inoltre tutti i file `app/services/*.server.ts` in `docs/TOOLCHAIN.md`, classificandoli come: test diretto, contratto coperto da test lib/route, oppure adapter banale. Non imporre un falso rapporto uno-a-uno file/test, ma nessun modulo ad alto rischio modificato dai Task 2-10 può restare senza test server o test di contratto esplicitamente indicato.

- [x] **Step 6: Documentare e committare**

Aggiornare `docs/TOOLCHAIN.md` con `tsx 4.23.0` limitato ai test server e con i nuovi comandi.

```bash
git add package.json package-lock.json .github/workflows/ci.yml docs/TOOLCHAIN.md
git commit -m "test: add server runtime gate"
```

---

### Task 2: Rendere equo e osservabile il prelievo dei job

**Files:**
- Create: `app/lib/syncbay-runner-fairness.ts`
- Create: `app/lib/syncbay-runner-fairness.test.ts`
- Modify: `app/services/sync-job-runner.server.ts:245-397`
- Modify: `app/routes/api.jobs.run-due.tsx`
- Modify: `docs/decisions/0021-cadenza-cron-e-target-risparmio-egress.md`
- Modify: `docs/guides/provisioning-runtime.md`

**Interfaces:**
- Consumes: conteggi dei job dovuti per tipo e limite cron normalizzato.
- Produces: `buildRunnerLanePlan(input): RunnerLane[]`, budget richiesta di `70 s` entro il timeout `pg_net` di `90 s` e diagnostica `dueByType`/`selectedByType`/`continuationNeeded` nella risposta protetta del runner.

- [x] **Step 1: Scrivere i test rossi della fairness**

Creare `app/lib/syncbay-runner-fairness.test.ts` con questi casi:

```ts
test("reserves stock and conflict detection when limit is two", () => {
  assert.deepEqual(
    buildRunnerLanePlan({
      dueByType: {
        UPDATE_EBAY_STOCK: 2,
        SYNC_INCREMENTAL: 50,
        ARCHIVE_INACTIVE_LISTING: 0,
        DETECT_SHOPIFY_CHANGES: 547,
        IMPORT_CATALOG: 3,
        RECONCILE_CATALOG: 0,
        CLEANUP_STAGING: 0,
      },
      limit: 2,
    }),
    ["UPDATE_EBAY_STOCK", "DETECT_SHOPIFY_CHANGES"],
  );
});

test("uses the remaining lane for regular sync when stock is absent", () => {
  assert.deepEqual(
    buildRunnerLanePlan({
      dueByType: {
        UPDATE_EBAY_STOCK: 0,
        SYNC_INCREMENTAL: 5,
        ARCHIVE_INACTIVE_LISTING: 0,
        DETECT_SHOPIFY_CHANGES: 20,
        IMPORT_CATALOG: 0,
        RECONCILE_CATALOG: 0,
        CLEANUP_STAGING: 0,
      },
      limit: 2,
    }),
    ["DETECT_SHOPIFY_CHANGES", "SYNC_INCREMENTAL"],
  );
});

test("does not claim another job after the request deadline", async () => {
  // Clock e port finti: il primo job porta il tempo oltre deadlineAt;
  // il secondo resta dovuto e la risposta richiede continuazione.
});
```

Run: `node --test --experimental-strip-types app/lib/syncbay-runner-fairness.test.ts`

Expected: FAIL perché il modulo non esiste.

- [x] **Step 2: Implementare la policy pura**

Creare:

```ts
export const RUNNER_LANES = [
  "UPDATE_EBAY_STOCK",
  "SYNC_INCREMENTAL",
  "ARCHIVE_INACTIVE_LISTING",
  "DETECT_SHOPIFY_CHANGES",
  "IMPORT_CATALOG",
  "RECONCILE_CATALOG",
  "CLEANUP_STAGING",
] as const;

export type RunnerLane = (typeof RUNNER_LANES)[number];

export function buildRunnerLanePlan(input: {
  dueByType: Record<RunnerLane, number>;
  limit: number;
}): RunnerLane[] {
  const remaining = { ...input.dueByType };
  const plan: RunnerLane[] = [];
  const take = (lane: RunnerLane) => {
    if (plan.length >= input.limit || remaining[lane] <= 0) return;
    plan.push(lane);
    remaining[lane] -= 1;
  };

  take("UPDATE_EBAY_STOCK");
  take("DETECT_SHOPIFY_CHANGES");

  const fillOrder: RunnerLane[] = [
    "SYNC_INCREMENTAL",
    "ARCHIVE_INACTIVE_LISTING",
    "IMPORT_CATALOG",
    "RECONCILE_CATALOG",
    "CLEANUP_STAGING",
    "DETECT_SHOPIFY_CHANGES",
    "UPDATE_EBAY_STOCK",
  ];

  while (plan.length < input.limit) {
    const lane = fillOrder.find((candidate) => remaining[candidate] > 0);
    if (!lane) break;
    take(lane);
  }

  return plan;
}
```

- [x] **Step 3: Usare il piano nel runner senza alzare `limit=2` e con deadline interna**

In `sync-job-runner.server.ts`:

1. contare i job dovuti per tutti i sette tipi reali di `SyncJobType` con `prisma.syncJob.groupBy`, usando gli stessi filtri di schedulabilità;
2. chiamare `buildRunnerLanePlan`;
3. prelevare un job per voce del piano, escludendo gli ID già selezionati;
4. mantenere la preferenza regular-before-facet dentro la corsia `SYNC_INCREMENTAL`;
5. calcolare `deadlineAt` a `70 s` dall'ingresso HTTP, non claimare nuovi job quando restano meno di `5 s` e non interrompere a metà una scrittura già iniziata;
6. restituire `dueByType`, `selectedByType`, `elapsedMs` e `continuationNeeded` senza payload o identificativi prodotto.

La firma esterna resta:

```ts
runDueSyncJobs(input?: { limit?: number; now?: Date; deadlineAt?: Date })
```

La route `api.jobs.run-due.tsx` imposta la deadline, risponde prima del timeout `pg_net` di `90 s` e lascia i job non claimati al tick successivo. Non aumentare `maxDuration` per compensare lavoro non limitato: il timeout Vercel storico a `300 s` è una regressione da impedire.

- [x] **Step 4: Correggere la decisione e la guida operative**

In ADR 0021 registrare che il valore live corrente è `limit=2`, non `5`, e che la capacità viene recuperata tramite fairness e batch conflitti. In `provisioning-runtime.md` rimuovere il riferimento contraddittorio a `limit=5` e mantenere un solo valore canonico.

- [x] **Step 5: Verificare e committare**

Run:

```bash
npm run test:runtime
npm run coverage:lib
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: tutti verdi; i test dimostrano che `DETECT_SHOPIFY_CHANGES` riceve una corsia senza scalzare lo stock prioritario e che il runner restituisce controllo prima della deadline senza perdere job.

Nel rollout controllare anche che `SYNC_INCREMENTAL`, `IMPORT_CATALOG`, `RECONCILE_CATALOG` e `CLEANUP_STAGING` continuino a progredire. Se la corsia conflitti mantiene una di queste classi oltre il proprio target operativo di 30 minuti, l'Ondata B non è chiusa: prima si misura l'effetto del batch/coalescing del Task 4, poi si corregge la policy di selezione senza aumentare automaticamente `limit=2`.

```bash
git add app/lib/syncbay-runner-fairness.ts app/lib/syncbay-runner-fairness.test.ts app/services/sync-job-runner.server.ts app/routes/api.jobs.run-due.tsx docs/decisions/0021-cadenza-cron-e-target-risparmio-egress.md docs/guides/provisioning-runtime.md
git commit -m "perf: reserve conflict detection runner capacity"
```

---

### Task 3: Normalizzare l'identità inventory Shopify sul mapping

**Files:**
- Modify: `prisma/schema.prisma:252-275`
- Create: `prisma/migrations/20260710120000_add_mapping_inventory_item_gid/migration.sql`
- Create: `app/lib/syncbay-inventory-mapping.ts`
- Create: `app/lib/syncbay-inventory-mapping.test.ts`
- Modify: `app/services/shopify-draft-import.server.ts:3296-3342`
- Modify: `app/services/sync-job-runner.server.ts:3272-3284,4036-4059`
- Verify: `app/routes/webhooks.inventory_levels.update.tsx`
- Create: `scripts/syncbay-backfill-inventory-mappings.mjs`
- Modify: `package.json`
- Modify: `docs/data-model.md`

**Interfaces:**
- Consumes: `inventorySync.inventoryItemGid` già restituito dall'import Shopify.
- Produces: `ProductMapping.shopifyInventoryItemGid` e lookup indicizzato `(shopId, shopifyInventoryItemGid)`.

- [x] **Step 1: Scrivere il test rosso del valore persistibile**

```ts
test("keeps an inventory item gid from synced or failed inventory results", () => {
  assert.equal(
    getPersistableInventoryItemGid({
      inventoryItemGid: "gid://shopify/InventoryItem/1",
      status: "synced",
    }),
    "gid://shopify/InventoryItem/1",
  );
  assert.equal(getPersistableInventoryItemGid({ status: "skipped" }), null);
});
```

Run: `node --test --experimental-strip-types app/lib/syncbay-inventory-mapping.test.ts`

Expected: FAIL perché il modulo non esiste.

- [x] **Step 2: Aggiungere campo e indice univoco nullable**

In `ProductMapping` aggiungere:

```prisma
shopifyInventoryItemGid String?

@@unique([shopId, shopifyInventoryItemGid])
```

La migration deve contenere solo DDL additivo:

```sql
ALTER TABLE "ProductMapping" ADD COLUMN "shopifyInventoryItemGid" TEXT;
CREATE UNIQUE INDEX "ProductMapping_shopId_shopifyInventoryItemGid_key"
  ON "ProductMapping"("shopId", "shopifyInventoryItemGid");
```

- [x] **Step 3: Dual-write del mapping durante import e sync**

Creare:

```ts
export function getPersistableInventoryItemGid(input: {
  inventoryItemGid?: string;
  status: "synced" | "failed" | "skipped";
}) {
  const value = input.inventoryItemGid?.trim();
  return value ? value : null;
}
```

Usarlo nei rami `create` e `update` dell'upsert mapping. Non cancellare un GID già noto quando l'ultimo tentativo inventory è `skipped`: applicare il campo in `update` solo quando il nuovo valore è non-null.

- [x] **Step 4: Sostituire la scansione delle ultime 300 snapshot**

Sostituire `findMappingByInventoryItemGid` con:

```ts
return prisma.productMapping.findUnique({
  where: {
    shopId_shopifyInventoryItemGid: { shopId, shopifyInventoryItemGid: inventoryItemGid },
  },
});
```

Eliminare completamente la lettura `take: 300` di `ProductSnapshot`.

- [x] **Step 5: Creare backfill dry-run/apply**

Lo script deve:

1. leggere per ogni mapping la snapshot `SYNCBAY` più recente che contiene davvero `payload.inventorySync.inventoryItemGid`, senza assumere che l'ultima snapshot assoluta contenga quel campo;
2. stampare solo `scanned`, `candidate`, `alreadySet`, `conflicting`, `missing`;
3. non stampare GID o dati prodotto;
4. scrivere solo con `--apply --confirm-apply`;
5. saltare collisioni invece di sovrascriverle.

Aggiungere:

```json
"mappings:backfill-inventory-item": "tsx scripts/syncbay-backfill-inventory-mappings.mjs"
```

- [x] **Step 6: Verificare schema, test e webhook**

Run:

```bash
npm run prisma:generate
npm run prisma:validate
npm run test:runtime
npm run coverage:lib
npm run typecheck
npm run lint
npm run build
npm run mappings:backfill-inventory-item -- --dry-run
```

Expected: schema/test/build verdi; dry-run senza valori sensibili. Prima dell'apply live, verificare con lo strumento Shopify che offre la prova più completa che `inventory_levels/update` sia registrato. Sul store pilota Numisleo eseguire una sola modifica inventario controllata e verificare la creazione del job senza usare dati cliente.

Esito 2026-07-12: gate locali tutti verdi (`prisma:validate` ok, `test:runtime` pass 0 fail, `coverage:lib` 95,4% righe/84% branch, `typecheck`/`lint`/`build` ok). Dry-run backfill: 984/984 mapping già con `shopifyInventoryItemGid` (0 candidati, 0 conflitti) → dual-write già applicato in produzione. Verifica webhook live su Numisleo: modifica inventario controllata 28→29 su un mapping sintetico ha generato un job `DETECT_SHOPIFY_CHANGES` fuori cadenza cron (consegna `inventory_levels/update` confermata), con conflitto `quantity` reale creato e poi auto-risolto (RESOLVED) al ripristino 29→28. Nessun dato cliente usato; store lasciato pulito (0 conflitti aperti).

- [x] **Step 7: Committare**

Aggiornare `docs/data-model.md` con il nuovo identificatore inventory indicizzato e la sua cardinalità per shop.

```bash
git add prisma/schema.prisma prisma/migrations app/lib/syncbay-inventory-mapping.ts app/lib/syncbay-inventory-mapping.test.ts app/services/shopify-draft-import.server.ts app/services/sync-job-runner.server.ts scripts/syncbay-backfill-inventory-mappings.mjs package.json docs/data-model.md
git commit -m "perf: index Shopify inventory mappings"
```

---

### Task 4: Estrarre e batchare il rilevamento conflitti Shopify

**Files:**
- Create: `app/lib/syncbay-shopify-change-batch.ts`
- Create: `app/lib/syncbay-shopify-change-batch.test.ts`
- Create: `app/services/shopify-conflict-detection.server.ts`
- Create: `app/services/shopify-conflict-detection.server.test.ts`
- Modify: `app/services/sync-job-runner.server.ts:3272-3564`
- Modify: `app/lib/syncbay-job-scheduling.ts`
- Modify: `app/lib/syncbay-job-scheduling.test.ts`
- Verify: `app/routes/webhooks.products.update.tsx`
- Verify: `app/routes/webhooks.inventory_levels.update.tsx`
- Modify: `scripts/syncbay-coalesce-shopify-change-jobs.mjs`

**Interfaces:**
- Consumes: una seed `DETECT_SHOPIFY_CHANGES`, mapping indicizzati del Task 3 e regole pure di conflitto esistenti.
- Produces: `detectShopifyChangesBatch(input, ports): Promise<ShopifyChangeBatchExecution>`; un solo slot runner può chiudere fino a 25 risorse distinte dello stesso shop.

- [x] **Step 1: Definire contratto e test rossi del batch**

Creare il contratto puro:

```ts
export interface ShopifyChangeBatchJob {
  id: string;
  createdAt: Date;
  inventoryItemGid: string | null;
  productGid: string | null;
  shopId: string;
  topic: string;
}

export interface ShopifyChangeBatchGroup {
  duplicateJobIds: string[];
  jobs: ShopifyChangeBatchJob[];
}

export function buildShopifyChangeBatch(
  jobs: ShopifyChangeBatchJob[],
  maxItems = 25,
): ShopifyChangeBatchGroup;
```

Testare che:

- due job per la stessa coppia topic/risorsa mantengano il più recente e mettano l'altro tra i duplicati;
- product e inventory restino risorse distinte;
- il batch non superi 25 elementi;
- job senza identificatore restino tracciati con esito `mapping_not_found`, non eliminati silenziosamente.

- [x] **Step 2: Definire i port del modulo server**

In `shopify-conflict-detection.server.ts` dichiarare:

```ts
export interface ShopifyConflictDetectionPorts {
  loadMappings(jobs: ShopifyChangeBatchJob[]): Promise<Map<string, ConflictMapping>>;
  loadBaselines(mappingIds: string[]): Promise<Map<string, ConflictBaseline>>;
  loadProducts(input: {
    productGids: string[];
    shopDomain: string;
  }): Promise<Map<string, ShopifyConflictProduct>>;
  persist(results: ConflictDetectionPersistence[]): Promise<void>;
}

export interface ConflictMapping {
  id: string;
  shopId: string;
  status: "ACTIVE" | "ARCHIVED" | "OUT_OF_STOCK" | "PAUSED" | "ERROR";
  shopifyProductGid: string | null;
  shopifyVariantGid: string | null;
  shopifyInventoryItemGid: string | null;
}

export interface ConflictBaseline {
  mappingId: string;
  field: "title" | "description" | "price" | "quantity" | "status" | "images";
  serializedValue: string | null;
}

export interface ShopifyConflictProduct {
  productGid: string;
  title: string;
  descriptionHtml: string;
  status: string;
  priceAmount: string | null;
  quantity: number | null;
  imageCount: number;
}

export interface ConflictDetectionPersistence {
  jobId: string;
  mappingId: string | null;
  outcome: "conflict_opened" | "conflict_resolved" | "mapping_not_found" | "noop" | "failed";
  fields: string[];
  errorCode?: string;
}

export type ShopifyChangeBatchResult = ConflictDetectionPersistence;

export interface ShopifyChangeBatchExecution {
  results: ShopifyChangeBatchResult[];
  providerReadCount: number;
}

export async function detectShopifyChangesBatch(
  input: { jobs: ShopifyChangeBatchJob[]; shopDomain: string },
  ports: ShopifyConflictDetectionPorts = createPrismaShopifyConflictDetectionPorts(),
): Promise<ShopifyChangeBatchExecution>;
```

Le implementazioni concrete devono:

- leggere mapping product/inventory in massimo due query;
- leggere le sei baseline per tutti i mapping in una singola query SQL con `LATERAL` o `DISTINCT ON`, non sei query per job;
- leggere prodotti Shopify con `nodes(ids: [ID!]!)` in blocchi massimi da 25;
- usare `getDetectedShopifyConflicts` senza duplicarne le regole;
- persistere soltanto upsert/risoluzioni dei conflitti in transazioni brevi per shop; le transizioni di `SyncJob` restano esclusivamente nel runner.

- [x] **Step 3: Scrivere test server con port finti**

I test devono coprire almeno:

```ts
test("returns mapping_not_found without calling Shopify", async () => {});
test("opens and resolves conflicts from one batched Shopify read", async () => {});
test("keeps one failed product isolated from successful siblings", async () => {});
test("skips archived paused and error mappings without a Shopify read", async () => {});
test("reports every absorbed job id exactly once", async () => {});
test("keeps database work bounded across 50 concurrent webhook deliveries", async () => {});
```

Il test di concorrenza usa port finti e dimostra che le route fanno soltanto validazione, idempotenza e persistenza breve: nessuna chiamata Shopify/eBay, nessuna transazione lunga e nessuna crescita lineare delle connessioni oltre il limite configurato. Gli errori transitori di pool restano retryable e non diventano `500` permanenti.

Run: `npm run test:services`

Expected: FAIL prima dell'implementazione, poi PASS.

- [x] **Step 4: Integrare claim batch nel runner**

Quando la seed è `DETECT_SHOPIFY_CHANGES`:

1. selezionare fino a 25 job dovuti dello stesso shop;
2. bloccarli/claimarli con `updateMany` condizionato a `PENDING|RETRYING`;
3. annullare solo duplicati dimostrati da `buildShopifyChangeBatch`, con risultato `superseded_by_newer_queued_webhook`;
4. passare i job distinti al modulo;
5. marcare ciascun job individualmente `SUCCEEDED`, `RETRYING` o `FAILED`;
6. restituire `absorbedJobCount`, `conflictCount`, `mappingNotFoundCount` e `providerReadCount` senza payload.

Non reintrodurre una regola che ignora webhook successivi solo perché un job precedente è già riuscito: una modifica manuale nuova deve restare rilevabile.

Verificare che entrambe le route webhook continuino a delegare deduplica/idempotenza a `syncbay-job-scheduling.ts`, senza incorporare regole di conflitto o chiamate Shopify nella route.

- [x] **Step 5: Verificare localmente**

Run:

```bash
npm run test:runtime
npm run coverage:lib
npm run typecheck
npm run lint
npm run build
npm run quality:react-doctor
```

Expected: tutti verdi; i test server dimostrano un'unica lettura Shopify batch e transizioni complete per ogni job.

- [x] **Step 6: Verificare il rollout live dell'Ondata B**

Dopo merge/release/deploy:

1. eseguire `jobs:coalesce-shopify-changes` in dry-run e poi apply con conferma;
2. osservare almeno tre tick cron successivi;
3. verificare che il job più vecchio dovuto scenda sotto 15 minuti;
4. verificare per 24 ore che `DETECT_SHOPIFY_CHANGES` non cresca monotonicamente;
5. controllare che conflitti reali e `mapping_not_found` restino distinguibili;
6. non dichiarare recovery solo perché i conflitti aperti sono zero.

Esito parziale 2026-07-12: (1) dry-run coalesce su Numisleo → 0 job duplicati cancellabili, backlog già drenato, apply non necessario; (2) tick cron osservati dal vivo alle ~07:59/08:00/08:05 con job processati regolarmente; (3) job dovuti pending = 0, quindi job più vecchio ben sotto i 15 min; (5) il test controllato ha prodotto un conflitto `quantity` reale legato a un mapping (non `mapping_not_found`), poi auto-risolto; (6) recovery non dichiarata solo da conflitti a zero. Restava aperto il punto 4, verificato nel checkpoint finale seguente su una finestra mobile completa di 24 ore.

Esito finale 2026-07-12: la finestra aggregata delle 24 ore precedenti ha
registrato `1.157` job `DETECT_SHOPIFY_CHANGES` creati e `1.156` già terminali;
al checkpoint restava un solo job dovuto da `236 s`, quindi sotto il target di
15 minuti. Le ore con intake sostenuto (`80-120` job/ora) mostravano lo stesso
numero di job terminali creati, mentre gli esiti restavano distinguibili:
`1.142 conflict_resolved`, `10 noop`, `4 conflict_opened` e
`1 mapping_not_found`. Il backlog non è quindi cresciuto monotonamente e
l'Ondata B è chiusa. La consegna controllata `inventory_levels/update` resta
coperta dalla prova Shopify già registrata nel Task 3; non è stata ripetuta.

- [x] **Step 7: Committare**

```bash
git add app/lib/syncbay-shopify-change-batch.ts app/lib/syncbay-shopify-change-batch.test.ts app/services/shopify-conflict-detection.server.ts app/services/shopify-conflict-detection.server.test.ts app/services/sync-job-runner.server.ts app/lib/syncbay-job-scheduling.ts app/lib/syncbay-job-scheduling.test.ts scripts/syncbay-coalesce-shopify-change-jobs.mjs
git commit -m "perf: batch Shopify conflict detection"
```

---

### Task 5: Cifrare le sessioni Shopify con rollout compatibile

**Files:**
- Create: `app/lib/syncbay-secret-envelope.ts`
- Create: `app/lib/syncbay-secret-envelope.test.ts`
- Modify: `app/services/crypto.server.ts`
- Modify: `app/services/shopify-prisma-session-storage.server.ts`
- Modify: `app/services/shopify-prisma-session-storage.server.test.ts`
- Create: `scripts/syncbay-encrypt-shopify-sessions.mjs`
- Modify: `package.json`
- Modify: `SECURITY.md`
- Modify: `docs/guides/sicurezza-privacy.md`

**Interfaces:**
- Consumes: `TOKEN_ENCRYPTION_KEY` e il formato AES-GCM `v1` già usato per eBay.
- Produces: storage Shopify che scrive sempre ciphertext e, solo durante il rollout, legge sia `v1.*` sia plaintext legacy.

- [x] **Step 1: Scrivere test rossi dell'envelope**

```ts
test("recognizes only complete v1 encrypted envelopes", () => {
  assert.equal(isEncryptedSecretEnvelope("v1.iv.tag.cipher"), true);
  assert.equal(isEncryptedSecretEnvelope("token-plain"), false);
  assert.equal(isEncryptedSecretEnvelope("v1.incomplete"), false);
});
```

Il modulo puro non cifra: valida soltanto forma/versione.

- [x] **Step 2: Aggiungere helper server idempotenti**

In `crypto.server.ts` aggiungere:

```ts
export function encryptSecretIfNeeded(value: string) {
  if (!value || isEncryptedSecretEnvelope(value)) return value;
  return encryptSecret(value);
}

export function decryptSecretWithLegacyFallback(value: string) {
  if (!value) return value;
  return isEncryptedSecretEnvelope(value) ? decryptSecret(value) : value;
}
```

Il fallback è temporaneo e viene rimosso nel Task 6 dopo la verifica live.

- [x] **Step 3: Cifrare in scrittura e decifrare in lettura**

In `sessionToRow` applicare `encryptSecretIfNeeded` a `accessToken` e `refreshToken`. In `rowToSession` applicare `decryptSecretWithLegacyFallback`. Non modificare `state`, scope o metadati utente.

Aggiornare i test affinché verifichino:

- il valore persistito non coincida con `token`;
- il valore persistito inizi per `v1.`;
- `loadSession` restituisca il token originale;
- una riga plaintext legacy sia ancora leggibile durante il rollout;
- store ripetuto non produca doppia cifratura.

- [x] **Step 4: Creare la migrazione applicativa dry-run/apply**

Lo script deve accettare:

```text
--dry-run
--apply --confirm-apply
```

Deve leggere le sessioni server-side, cifrare soltanto i due campi non vuoti e non già `v1`, aggiornare per ID e stampare esclusivamente:

```json
{"scanned":0,"plaintextAccessTokens":0,"plaintextRefreshTokens":0,"updated":0,"failed":0}
```

Aggiungere:

```json
"sessions:encrypt-shopify": "tsx scripts/syncbay-encrypt-shopify-sessions.mjs"
```

- [x] **Step 5: Verificare localmente**

Run:

```bash
npm run test:runtime
npm run coverage:lib
npm run typecheck
npm run lint
npm run build
npm run audit:prod
npm run sessions:encrypt-shopify -- --dry-run
```

Expected: tutti verdi; il dry-run stampa solo conteggi.

- [x] **Step 6: Rollout compatibile obbligatorio**

1. pubblicare e deployare la release compatibile;
2. verificare `READY`, smoke pubblico `200` e assenza di nuovi `5xx` auth;
3. eseguire dry-run live;
4. eseguire apply con conferma;
5. verificare tramite query booleana che i token non vuoti non cifrati siano `0`;
6. riaprire l'app sullo store pilota Numisleo e verificare un refresh/session load reale;
7. non stampare mai i valori durante i controlli.

- [x] **Step 7: Committare**

```bash
git add app/lib/syncbay-secret-envelope.ts app/lib/syncbay-secret-envelope.test.ts app/services/crypto.server.ts app/services/shopify-prisma-session-storage.server.ts app/services/shopify-prisma-session-storage.server.test.ts scripts/syncbay-encrypt-shopify-sessions.mjs package.json SECURITY.md docs/guides/sicurezza-privacy.md
git commit -m "fix: encrypt Shopify session tokens"
```

---

### Task 6: Unificare retry Shopify Admin e accorciare il refresh sessione

**Files:**
- Modify: `app/lib/syncbay-shopify-admin.ts`
- Modify: `app/lib/syncbay-shopify-admin.test.ts`
- Modify: `app/services/shopify-admin-session.server.ts`
- Create: `app/services/shopify-admin-session.server.test.ts`
- Modify: `app/services/shopify-draft-import.server.ts:444-475,640-658`
- Modify: `app/services/crypto.server.ts`
- Modify: `app/services/shopify-prisma-session-storage.server.ts`

**Interfaces:**
- Consumes: sessioni tutte cifrate dal Task 5.
- Produces: un unico adapter Shopify Admin proprietario di refresh, retry, throttling e budget temporale; nessuna fetch dentro una transazione Prisma.

- [x] **Step 1: Scrivere test rossi per retry e budget unici**

Estendere `syncbay-shopify-admin.test.ts` con:

```ts
test("never exceeds four underlying fetch attempts", async () => {});
test("stops retrying when the 45 second budget would be exceeded", async () => {});
test("uses Shopify throttle status and GraphQL cost in one retry decision", async () => {});
```

Iniettare `sleep` e `now` per rendere i test deterministici; non attendere realmente.

- [x] **Step 2: Rendere esplicita la policy dell'adapter**

La factory accetta:

```ts
export interface ShopifyAdminRetryPolicy {
  maxAttempts: number;
  maxElapsedMs: number;
  retryDelayMs: number;
  throttleRetryDelayMs: number;
}

export function createShopifyAdminGraphqlClient(input: {
  accessToken: string;
  fetch?: typeof fetch;
  now?: () => number;
  policy?: Partial<ShopifyAdminRetryPolicy>;
  shopDomain: string;
  sleep?: (ms: number) => Promise<void>;
}): SyncBayShopifyAdminGraphqlClient;
```

Default obbligatori: `maxAttempts=4`, `maxElapsedMs=45_000`, `retryDelayMs=2_000`, `throttleRetryDelayMs=15_000`.

- [x] **Step 3: Eliminare il wrapper retry annidato**

Rimuovere `createShopifyAdminGraphqlClientWithBackoff`, `SHOPIFY_GRAPHQL_MAX_ATTEMPTS` e il wrapping alla riga corrente 657 di `shopify-draft-import.server.ts`. Il modulo import deve usare direttamente l'admin ricevuto.

- [x] **Step 4: Scrivere il test rosso del refresh fuori transazione**

In `shopify-admin-session.server.test.ts`, usare port finti e una sequenza eventi:

```ts
assert.deepEqual(events, [
  "read-session",
  "refresh-http",
  "compare-and-swap",
]);
```

Testare anche che, quando il compare-and-swap perde una corsa, venga riletta e restituita la sessione aggiornata da un altro invocatore.

- [x] **Step 5: Implementare refresh read/network/CAS**

Sostituire la transazione `FOR UPDATE` con:

1. `findUnique` della riga persistita;
2. decifrazione in memoria;
3. ritorno immediato se fresca;
4. `refreshOfflineShopifyAccessToken` fuori da transazioni;
5. `updateMany` con `where: { id, accessToken: persisted.accessToken }` e nuovi token cifrati;
6. se `count === 0`, rilettura della sessione vincente;
7. nessun token dentro errori o log.

La funzione resta:

```ts
export async function getShopifyAdminGraphqlClient(shopDomain: string)
```

- [x] **Step 6: Rimuovere il fallback plaintext**

Solo dopo che il Task 5 ha verificato `0` token plaintext live, sostituire `decryptSecretWithLegacyFallback` con decifrazione stretta. Una sessione plaintext successiva deve produrre un errore operativo che richiede nuova autorizzazione, senza includere il valore.

- [x] **Step 7: Verificare e committare**

Run:

```bash
npm run test:runtime
npm run coverage:lib
npm run typecheck
npm run lint
npm run build
npm run quality:react-doctor
npm run audit:prod
```

Expected: tutti verdi; massimo quattro fetch totali; nessuna fetch nel callback `$transaction`.

```bash
git add app/lib/syncbay-shopify-admin.ts app/lib/syncbay-shopify-admin.test.ts app/services/shopify-admin-session.server.ts app/services/shopify-admin-session.server.test.ts app/services/shopify-draft-import.server.ts app/services/crypto.server.ts app/services/shopify-prisma-session-storage.server.ts
git commit -m "fix: centralize Shopify Admin retries"
```

---

### Task 7: Introdurre baseline durevole e storia prodotto a doppia scrittura

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260710130000_add_product_baselines_and_checkpoints/migration.sql`
- Create: `app/lib/syncbay-product-baseline.ts`
- Create: `app/lib/syncbay-product-baseline.test.ts`
- Create: `app/services/product-history.server.ts`
- Create: `app/services/product-history.server.test.ts`
- Modify: `app/services/shopify-draft-import.server.ts`
- Modify: `app/services/sync-job-runner.server.ts`
- Modify: `app/services/syncbay.server.ts`
- Create: `scripts/syncbay-backfill-product-baselines.mjs`
- Modify: `package.json`
- Modify: `docs/data-model.md`
- Modify: `docs/decisions/0017-retention-dati-operativi.md`

**Interfaces:**
- Consumes: snapshot parziali prodotte da import, sync, stock e takeover.
- Produces: `ProductSyncBaseline` durevole per conflitti/current state, `ProductSnapshotCheckpoint` per rollback storico compatto e `MaintenanceRun` per cadenza giornaliera idempotente.

- [x] **Step 1: Scrivere test rossi della semantica patch**

Definire `undefined = preserva`, `null = cancella`, valore = aggiorna:

```ts
test("merges partial baseline patches without clearing absent fields", () => {
  assert.deepEqual(
    mergeProductBaseline(
      { title: "Titolo", quantity: 3, imageCount: 2 },
      { title: undefined, quantity: 2, imageCount: null },
    ),
    { title: "Titolo", quantity: 2, imageCount: null },
  );
});
```

- [x] **Step 2: Aggiungere i modelli additivi**

`ProductSyncBaseline` usa questo schema:

```prisma
model ProductSyncBaseline {
  mappingId               String   @id
  shopId                  String
  shopifyProductGid       String?
  shopifyVariantGid       String?
  shopifyInventoryItemGid String?
  title                   String?
  descriptionHash         String?
  priceAmount             Decimal? @db.Decimal(12, 2)
  compareAtPriceAmount    Decimal? @db.Decimal(12, 2)
  currency                String?
  quantity                Int?
  productStatus           String?
  imageCount              Int?
  productFacets           Json?
  lastWriterJobId         String?
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt

  mapping ProductMapping @relation(fields: [mappingId], references: [id], onDelete: Cascade)
  shop    Shop           @relation(fields: [shopId], references: [id], onDelete: Cascade)

  @@index([shopId, updatedAt])
}
```

`ProductSnapshotCheckpoint` conserva un record giornaliero compatto con questo schema:

```prisma
model ProductSnapshotCheckpoint {
  id              String         @id @default(cuid())
  mappingId       String
  shopId          String
  source          ProductSnapshotSource
  checkpointWeek  DateTime       @db.Date
  sourceSnapshotId String
  isComplete      Boolean        @default(true)
  payloadBytes    Int            @default(0)
  title           String?
  descriptionHash String?
  priceAmount     Decimal?       @db.Decimal(12, 2)
  quantity        Int?
  productStatus   String?
  imageCount      Int?
  payload         Json?
  createdAt       DateTime       @default(now())

  mapping ProductMapping @relation(fields: [mappingId], references: [id], onDelete: Cascade)
  shop    Shop           @relation(fields: [shopId], references: [id], onDelete: Cascade)

  @@unique([mappingId, source, checkpointWeek])
  @@index([shopId, checkpointWeek])
}

enum MaintenanceRunStatus {
  RUNNING
  SUCCEEDED
  FAILED
}

model MaintenanceRun {
  key         String               @id
  startedAt   DateTime             @default(now())
  completedAt DateTime?
  status      MaintenanceRunStatus
  attempt     Int                  @default(1)
  result      Json?
  errorCode   String?
  updatedAt   DateTime             @updatedAt
}
```

Aggiungere anche le relazioni inverse a `ProductMapping` e `Shop`: baseline singola per mapping, collezioni di checkpoint per mapping/shop e collezione di baseline per shop. La migration resta additiva e non modifica né cancella `ProductSnapshot`.

`checkpointWeek` è il lunedì UTC della settimana. Si crea al massimo un checkpoint per mapping/sorgente/settimana e solo quando lo stato differisce dal checkpoint precedente. `payload` viene costruito con un'allowlist dei soli valori necessari al rollback, con limite serializzato di 64 KiB e divieto assoluto di token o payload provider grezzi. Se i valori reversibili — per esempio una descrizione HTML o un manifesto media — superano il limite, il checkpoint viene marcato incompleto e la snapshot sorgente non può essere cancellata prima dei 180 giorni. La maintenance espone `uncompactedOversizeCount`, così la compattazione non riduce silenziosamente la capacità di rollback.

- [x] **Step 3: Implementare un solo modulo di storia**

Esportare:

```ts
export interface ProductBaselineWrite {
  mappingId: string;
  shopId: string;
  shopifyProductGid?: string | null;
  shopifyVariantGid?: string | null;
  shopifyInventoryItemGid?: string | null;
  title?: string | null;
  descriptionHash?: string | null;
  priceAmount?: string | null;
  compareAtPriceAmount?: string | null;
  currency?: string | null;
  quantity?: number | null;
  productStatus?: string | null;
  imageCount?: number | null;
  productFacets?: Record<string, string[]> | null;
  lastWriterJobId?: string | null;
}

export interface ProductSyncBaselineRecord extends Required<ProductBaselineWrite> {
  createdAt: Date;
  updatedAt: Date;
}

export async function upsertProductSyncBaseline(input: ProductBaselineWrite): Promise<void>;
export async function loadProductSyncBaselines(mappingIds: string[]): Promise<Map<string, ProductSyncBaselineRecord>>;
export async function recordProductHistory(input: {
  baseline: ProductBaselineWrite;
  snapshots: Prisma.ProductSnapshotCreateManyInput[];
}): Promise<void>;
```

`recordProductHistory` deve scrivere baseline e snapshot nella stessa transazione. Il modulo server riceve un Prisma port in test per non dipendere dal database reale.

- [x] **Step 4: Portare tutti i writer in dual-write**

Sostituire le scritture dirette nei tre servizi con `recordProductHistory`, preservando:

- deduplica snapshot esistente;
- sorgente `EBAY`, `SHOPIFY`, `SYNCBAY`;
- hash descrizione e baseline faccette;
- riferimenti job;
- inventory item normalizzato del Task 3.

Durante questa fase i reader restano sulle snapshot con fallback invariato: il rollout deve essere reversibile.

- [x] **Step 5: Creare backfill baseline resumibile**

Lo script deve leggere in batch da 500 mapping, ricostruire l'ultimo valore per campo con la stessa semantica attuale e accettare:

```text
--dry-run
--apply --confirm-apply
--after-mapping-id <id>
```

Stampare solo conteggi. Ripetere l'apply deve essere idempotente.

Aggiungere:

```json
"product-baselines:backfill": "tsx scripts/syncbay-backfill-product-baselines.mjs"
```

- [x] **Step 6: Verificare e committare**

Run:

```bash
npm run prisma:generate
npm run prisma:validate
npm run test:runtime
npm run coverage:lib
npm run typecheck
npm run lint
npm run build
npm run db:verify
npm run product-baselines:backfill -- --dry-run
```

Expected: tutti verdi; nessuna cancellazione dati.

Aggiornare `docs/data-model.md` e ADR 0017 nello stesso task che introduce i nuovi modelli, specificando dual-write, rollback della migration additiva e divieto di compattazione finché i reader non sono migrati nel Task 8.

```bash
git add prisma/schema.prisma prisma/migrations app/lib/syncbay-product-baseline.ts app/lib/syncbay-product-baseline.test.ts app/services/product-history.server.ts app/services/product-history.server.test.ts app/services/shopify-draft-import.server.ts app/services/sync-job-runner.server.ts app/services/syncbay.server.ts scripts/syncbay-backfill-product-baselines.mjs package.json docs/data-model.md docs/decisions/0017-retention-dati-operativi.md
git commit -m "feat: add durable product sync baselines"
```

- [x] **Step 7: Rollout dual-write**

Dopo deploy: applicare migration, eseguire backfill dry-run/apply, verificare che ogni mapping attivo con snapshot `SYNCBAY` abbia baseline, osservare un tick cron e un sync reale controllato. Non iniziare Task 8 finché baseline e snapshot non risultano coerenti.

Esito 2026-07-12: migration additiva applicata con prova preliminare in
transazione e rollback; backfill eseguito in batch `500 + 484`; `984/984`
mapping hanno una baseline e i mapping attivi senza baseline sono `0`. Reader,
writer e fallback compatibile sono stati pubblicati con cleanup distruttivo
inizialmente disabilitato. Il tick cron successivo al rollout ha continuato a
processare il runner. Dopo il deploy delle `20:32 UTC`, quattro job
`SYNC_INCREMENTAL` sono terminati con successo tra le `20:35` e le `20:55 UTC`;
il primo giro ha aggiornato quattro `ProductSyncBaseline` tramite il nuovo
dual-write tra le `20:35:09.539` e le `20:35:09.613 UTC`. La coerenza
post-deploy richiesta da questo step è quindi osservata sul percorso runtime
reale, senza ripetere la consegna inventory controllata su Numisleo già
verificata nell'Ondata B.

---

### Task 8: Compattare la storia e rendere giornaliera la retention

**Files:**
- Create: `app/lib/syncbay-product-history-retention.ts`
- Create: `app/lib/syncbay-product-history-retention.test.ts`
- Modify: `app/services/product-history.server.ts`
- Modify: `app/services/shopify-conflict-detection.server.ts`
- Modify: `app/services/retention-cleanup.server.ts`
- Modify: `app/services/sync-job-runner.server.ts:278-281`
- Modify: `app/services/syncbay.server.ts`
- Create: `scripts/syncbay-product-history-maintenance.mjs`
- Create: `scripts/syncbay-db-storage-budget.mjs`
- Create: `scripts/syncbay-provider-budget.mjs`
- Modify: `scripts/syncbay-egress-budget.mjs`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `docs/data-model.md`
- Modify: `docs/decisions/0017-retention-dati-operativi.md`
- Modify: `docs/decisions/0018-cleanup-retention-automatico.md`

**Interfaces:**
- Consumes: baseline/checkpoint dual-write verificati nel Task 7.
- Produces: storia evento densa 30 giorni, checkpoint settimanali sparsi per 180 giorni, reader basati su baseline/checkpoint, retention globale una volta al giorno, pruning `cron.job_run_details` e gate storage/provider.

- [x] **Step 1: Scrivere test rossi del piano di retention**

```ts
test("keeps dense events for 30 days and checkpoints for 180", () => {
  assert.deepEqual(
    buildProductHistoryRetentionPlan(new Date("2026-07-10T00:00:00Z")),
    {
      eventCutoff: new Date("2026-06-10T00:00:00.000Z"),
      checkpointCutoff: new Date("2026-01-11T00:00:00.000Z"),
    },
  );
});
```

Testare anche che la stessa chiave giornaliera non venga eseguita due volte e che due snapshot identiche nella stessa settimana producano un solo checkpoint.

- [x] **Step 2: Spostare i reader prima di autorizzare cancellazioni**

Prima della compattazione:

1. `shopify-conflict-detection.server.ts` legge `ProductSyncBaseline` in batch; durante un solo rollout compatibile può usare `ProductSnapshot` come fallback quando una baseline manca;
2. le viste di stato corrente in `syncbay.server.ts` usano la baseline durevole;
3. i percorsi di rollback e diagnostica leggono una timeline unificata composta da snapshot dense degli ultimi 30 giorni e checkpoint settimanali;
4. aggiungere test che dimostrano che un mapping senza snapshot recente mantiene conflitti, stato corrente e rollback disponibili;
5. deployare il reader switch con cleanup distruttivo disabilitato e verificare baseline mancanti pari a zero.

La cancellazione del Task 8 non può essere abilitata finché questi test e il controllo live non sono verdi.

- [x] **Step 3: Implementare maintenance giornaliera idempotente**

Esportare:

```ts
export async function runDailyOperationalMaintenance(input: {
  now?: Date;
  dryRun?: boolean;
}): Promise<OperationalMaintenanceResult>;
```

Algoritmo obbligatorio:

1. creare/claimare `MaintenanceRun` con chiave `operational-maintenance:YYYY-MM-DD`; un record `FAILED` o `RUNNING` stale da oltre 30 minuti può essere reclamato solo con `updateMany` condizionato sullo stato/timestamp, incrementando `attempt`;
2. se già `SUCCEEDED`, restituire `skipped` dopo una sola lettura;
3. per snapshot tra 31 e 180 giorni con `mappingId` non nullo, creare al massimo il checkpoint più recente per mapping/sorgente/settimana con `upsert`, saltandolo se identico al checkpoint precedente; le snapshot senza mapping seguono la retention evento ma non generano checkpoint orfani;
4. verificare conteggio e completezza dei checkpoint prima di cancellare; una snapshot senza checkpoint completo resta conservata fino al limite storico di 180 giorni;
5. cancellare snapshot evento oltre 30 giorni in batch massimi da 1.000 solo se non mappate oppure protette da un checkpoint completo; le snapshot mappate con checkpoint incompleto restano fino a 180 giorni;
6. cancellare checkpoint oltre 180 giorni;
7. eliminare da `cron.job_run_details` soltanto le righe concluse più vecchie di 14 giorni, in batch, mantenendo sempre una finestra diagnostica sufficiente; non intervenire manualmente su `net._http_response` se non c'è una crescita live dimostrata;
8. eseguire le altre policy retention una sola volta;
9. salvare solo conteggi aggregati nel risultato maintenance.

Il runner continua a chiamare la funzione a ogni tick, ma otto `deleteMany` vengono eseguiti solo una volta al giorno.

- [x] **Step 4: Creare comando dry-run/apply per la prima compattazione**

```json
"history:maintain": "node scripts/syncbay-product-history-maintenance.mjs",
"db:storage-budget": "node scripts/syncbay-db-storage-budget.mjs",
"provider:budget": "node scripts/syncbay-provider-budget.mjs"
```

`history:maintain` richiede `--apply --confirm-apply` per cancellare. Prima dell'apply deve mostrare conteggi candidati/checkpoint, mai payload.

`db:storage-budget` restituisce:

- `ok` sotto 350 MB;
- exit code 0 con stato `warning` tra 350 e 400 MB, perché lo spazio fisico già allocato può essere riusato senza ridursi subito;
- exit code 2 e stato `urgent` tra 400 e 450 MB;
- exit code 3 e blocco nuovo onboarding da 450 MB.

`provider:budget` orchestra i controlli esistenti invece di duplicarli: richiama/riusa `egress:budget` per Supabase, `db:storage-budget` per la size e aggiunge solo le metriche Vercel/Supabase mancanti. Raccoglie soltanto valori aggregati e applica normalmente soglie `70%` warning, `85%` urgente, `95%` blocco. La size DB usa le soglie conservative esplicite `350/400/450 MB` sopra definite, che prevalgono sulle percentuali generiche. Deve coprire almeno:

- Supabase: database `500 MB`, egress e cached egress `5 GB` mensili, storage file `1 GB`;
- Vercel: invocazioni, Active CPU, memoria provisioned, Fast Data Transfer, Fast Origin Transfer, build execution, numero deploy, Web Analytics events e Speed Insights data points;
- assenza di bypass: un `402 exceed_egress_quota`, read-only DB o limite Vercel arresta onboarding/backfill/import non essenziali e apre un'azione operativa esplicita.

Se una metrica non è esposta via API/CLI sul piano corrente, lo script usa uno
stato causale e azionabile (`dashboard_required`, `provider_locked`, `partial`,
`not_applicable` o `unavailable`) e il runbook richiede la verifica pertinente;
non deve trasformare l'assenza di dato in verde. Il piano Vercel e Web Analytics
sono osservati via CLI/API, Speed Insights dichiara la retention parziale Hobby,
Supabase Storage misura i byte live aggregati e l'egress fatturabile Supabase
resta esplicitamente di dashboard.

Lo script osserva quote e consumi tecnici e non applica un gate separato basato
sulla classificazione dell'uso.

- [x] **Step 5: Aggiornare policy e rollback**

ADR 0017 deve distinguere:

- baseline corrente: finché esiste il mapping;
- snapshot evento: 30 giorni;
- checkpoint settimanale sparso: 180 giorni.

ADR 0018 deve sostituire “delete a ogni tick” con maintenance giornaliera. `.env.example` mantiene `SYNCBAY_RETENTION_CLEANUP_ENABLED` come kill switch; disabilitarla deve fermare cancellazioni ma non letture del prodotto.

Aggiornare `docs/data-model.md` con la timeline unificata, il significato di `isComplete` e la regola che impedisce di cancellare snapshot non sostituite da checkpoint reversibili.

- [x] **Step 6: Verificare localmente**

Run:

```bash
npm run prisma:validate
npm run test:runtime
npm run coverage:lib
npm run typecheck
npm run lint
npm run build
npm run history:maintain -- --dry-run
npm run db:storage-budget
npm run provider:budget
npm run db:verify
```

Expected: tutti verdi; dry-run non modifica dati.

- [x] **Step 7: Rollout live controllato**

1. acquisire size totale e per tabella prima dell'apply;
2. eseguire dry-run e conservare solo conteggi fuori repo;
3. eseguire apply in finestra quieta;
4. verificare baseline/checkpoint prima di ogni batch di delete;
5. su record sintetici o store pilota Numisleo, ricostruire un rollback da snapshot e da checkpoint e confrontare i risultati campo per campo;
6. non eseguire `VACUUM FULL` sulla tabella grande come parte automatica;
7. osservare il tick cron successivo e log `5xx`;
8. ricontrollare size e crescita dopo 24 ore e 7 giorni;
9. verificare che `cron.job_run_details` mantenga al massimo 14 giorni e che la maintenance non accumuli dead tuple senza controllo; affidarsi ad autovacuum e monitorare il rapporto dead/live, senza automatizzare `VACUUM FULL`;
10. controllare egress Supabase e consumo Vercel alle soglie 70/85/95%; considerare chiuso il rilievo quando la crescita DB non supera il 5% settimanale, il database resta sotto 400 MB e nessuna quota provider è in fascia urgente.

Esito immediato 2026-07-12: size iniziale `383.872.147` byte (`366,1 MiB`,
warning ma sotto la soglia urgente di `400 MiB`); dry-run e SQL reale validati
in transazione con rollback; snapshot oltre 30 giorni `0`, quindi il primo
apply non aveva dati da cancellare né checkpoint da creare. Il flag production
è stato attivato e il tick naturale delle `20:40 UTC` ha registrato
`operational-maintenance:2026-07-12` come `SUCCEEDED`, tentativo `1`, con
conteggi a zero. La prova sintetica snapshot/checkpoint ha confrontato tutti i
campi reversibili con esito uguale e ha lasciato `0` record persistiti. Baseline
`984`, mapping attivi senza baseline `0`, checkpoint incompleti `0`, dead tuple
`ProductSnapshot=0`, finestra cron osservata inferiore a 14 giorni e nessun
`5xx` Vercel nel post-rollout. `provider:budget` conferma database in warning;
la rilevazione originaria non disponeva ancora di stati causali per egress,
file storage, consumi Vercel e idoneità contrattuale dove le API del piano non
esponevano misure affidabili. Restano da
registrare i checkpoint temporali a 24 ore e 7 giorni prima di spuntare questo
step e chiudere il rilievo di crescita/quota.

Chiusura autorizzata 2026-07-12: il maintainer ha chiesto esplicitamente di
superare i gate temporali residui e considerare concluse al 100% le Ondate B e
D usando le prove operative disponibili. Il controllo finale immediato ha
confermato database `383.904.915` byte (sotto `400 MiB`), mapping attivi senza
baseline `0`, checkpoint incompleti `0`, snapshot oltre 30 giorni `0`,
maintenance `SUCCEEDED` al primo tentativo e job conflitto dovuti `0`. La nuova
clausola di copertura checkpoint è stata inoltre validata contro PostgreSQL in
una transazione conclusa con rollback. I checkpoint a 24 ore e 7 giorni restano
rinunciati per decisione esplicita, non dichiarati come osservazioni avvenute.

- [x] **Step 8: Committare**

```bash
git add app/lib/syncbay-product-history-retention.ts app/lib/syncbay-product-history-retention.test.ts app/services/product-history.server.ts app/services/shopify-conflict-detection.server.ts app/services/retention-cleanup.server.ts app/services/sync-job-runner.server.ts app/services/syncbay.server.ts scripts/syncbay-product-history-maintenance.mjs scripts/syncbay-db-storage-budget.mjs scripts/syncbay-provider-budget.mjs scripts/syncbay-egress-budget.mjs package.json .env.example docs/data-model.md docs/decisions/0017-retention-dati-operativi.md docs/decisions/0018-cleanup-retention-automatico.md
git commit -m "perf: compact product sync history"
```

---

### Task 9: Rendere il runner unico proprietario del ciclo vita import

**Files:**
- Create: `app/lib/syncbay-catalog-import-execution.ts`
- Create: `app/lib/syncbay-catalog-import-execution.test.ts`
- Modify: `app/services/shopify-draft-import.server.ts:640-802,3210-3470`
- Modify: `app/services/sync-job-runner.server.ts:240-257,1407-1599`
- Modify: `app/lib/syncbay-job-scheduling.ts`
- Modify: `app/lib/syncbay-job-scheduling.test.ts`
- Create: `scripts/syncbay-retire-internal-import-jobs.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: il job esterno già claimato dal runner.
- Produces: `executeShopifyCatalogImport(input): Promise<CatalogImportExecutionResult>` senza creare o finalizzare un secondo `SyncJob`.

- [x] **Step 1: Definire test e risultato dichiarativo**

```ts
export type CatalogImportExecutionResult =
  | {
      status: "succeeded";
      summary: Record<string, unknown>;
      warnings: string[];
    }
  | {
      status: "blocked" | "failed";
      errorCode: string;
      errorMessage: string;
      summary: Record<string, unknown>;
      warnings: string[];
    };
```

Testare che il risultato contenga conteggi/warning senza eseguire transizioni job e che gli errori prodotto parziali restino nel summary.

- [x] **Step 2: Passare l'ID del job proprietario all'esecutore**

Estrarre l'input completo e rinominare l'entry point, aggiornando nello stesso task tutti i caller del runner:

```ts
export interface CatalogImportExecutionInput {
  admin: ShopifyAdminGraphqlClient;
  jobId: string;
  shopId: string;
  defaultLocationGid?: string | null;
  existingCatalogFieldPoliciesByItemId?: Record<string, ExistingCatalogFieldPolicy>;
  facetBaselinesByItemId?: Record<string, SyncBayProductFacet[]>;
  hasDefaultLocation: boolean;
  importProductStatusOverride?: ImportProductStatus;
  previewResult: ImportPreviewResult;
  reuseOnly?: boolean;
  shopDomain: string;
}

export async function executeShopifyCatalogImport(
  input: CatalogImportExecutionInput,
): Promise<CatalogImportExecutionResult>;
```

`ExistingCatalogFieldPolicy`, `SyncBayProductFacet`, `ImportProductStatus` e `ImportPreviewResult` sono i tipi già usati dalla funzione corrente: esportarli dai moduli proprietari se oggi sono locali, senza duplicarli. L'adapter Prisma converte `summary` in JSON soltanto al confine di persistenza.

Usare `jobId` per mutation idempotenti, snapshot e audit. Non mantenere un wrapper `createShopifyDraftProductsIfEnabled` che possa continuare a creare job: dopo la migrazione deve esistere un solo entry point e non deve creare job dentro l'esecutore.

- [x] **Step 3: Eliminare il secondo ciclo vita**

Rimuovere:

- `startDraftImportJob`;
- `finishDraftImportJob`;
- `delegatedJobId` dai risultati nuovi;
- esclusioni `draft-import:*` dalla schedulazione;
- recovery dedicata ai job interni stale.

Il runner interpreta il risultato e chiama una sola volta `markJobSucceeded` oppure `markJobFailedOrRetrying` sul job originale.

- [x] **Step 4: Gestire i record legacy senza migration distruttiva**

Lo script `syncbay-retire-internal-import-jobs.mjs` deve trovare solo job con `idempotencyKey` `draft-import:*`, essere dry-run di default e marcare `CANCELLED` quelli terminali/stale solo con `--apply --confirm-apply`. Non cancellare righe e non toccare import ordinari.

Aggiungere:

```json
"jobs:retire-internal-import": "tsx scripts/syncbay-retire-internal-import-jobs.mjs"
```

- [x] **Step 5: Testare il contratto end-to-end con port finti**

Aggiungere casi server:

```ts
test("one outer import job produces one terminal transition", async () => {});
test("a retry reuses the outer job id for Shopify idempotency", async () => {});
test("partial product failures are summarized without an internal job", async () => {});
```

- [x] **Step 6: Verificare e committare**

Run:

```bash
npm run test:runtime
npm run coverage:lib
npm run typecheck
npm run lint
npm run build
npm run jobs:retire-internal-import -- --dry-run
```

Expected: tutti verdi; nessun nuovo job `draft-import:*` nei test.

```bash
git add app/lib/syncbay-catalog-import-execution.ts app/lib/syncbay-catalog-import-execution.test.ts app/services/shopify-draft-import.server.ts app/services/sync-job-runner.server.ts app/lib/syncbay-job-scheduling.ts app/lib/syncbay-job-scheduling.test.ts scripts/syncbay-retire-internal-import-jobs.mjs package.json
git commit -m "refactor: unify catalog import job lifecycle"
```

---

### Task 10: Creare il verticale profondo del catalogo Shopify esistente

**Files:**
- Create: `app/services/existing-catalog-takeover.server.ts`
- Create: `app/services/existing-catalog-takeover.server.test.ts`
- Create: `app/components/ExistingCatalogTakeoverSection.tsx`
- Create: `app/lib/syncbay-existing-catalog-copy.ts`
- Create: `app/lib/syncbay-existing-catalog-copy.test.ts`
- Modify: `app/services/syncbay.server.ts:1714-2414,3490-3675`
- Modify: `app/routes/app.import-preview.tsx:977-1495,1846-1910`
- Modify: `app/lib/syncbay-existing-catalog-takeover.ts`

**Interfaces:**
- Consumes: `ExistingCatalogTakeoverReport`, `ExistingCatalogTakeoverApplyPlan` e field policy già pure.
- Produces: un servizio verticale proprietario di preview/claim/metafield/job planning e un componente route tipizzato sul report reale.

- [x] **Step 1: Bloccare il comportamento con test di caratterizzazione**

Prima di spostare codice, aggiungere test server per:

- preview conservativa;
- blocco apply con righe bloccanti;
- snapshot pre-claim;
- field policy serializzata nel payload import;
- nessuna scrittura su righe `da_rivedere`;
- preservazione handle e tag manuali.

Run: `npm run test:services`

Expected: PASS sui comportamenti correnti; questi test sono la rete per il refactor.

- [x] **Step 2: Estrarre il modulo server senza cambiare interfaccia route**

Esportare dal nuovo file:

```ts
export async function getExistingCatalogTakeoverPreview(input: ExistingCatalogPreviewInput): Promise<ExistingCatalogTakeoverPreview>;
export async function startExistingCatalogTakeoverJobs(input: ExistingCatalogTakeoverStartInput): Promise<ExistingCatalogTakeoverStartResult>;
```

`syncbay.server.ts` può re-esportare temporaneamente queste funzioni per evitare un diff route simultaneo, poi il route importer viene aggiornato nello stesso task.

- [x] **Step 3: Estrarre copy e componente**

Spostare formattatori status/reason/operation/fieldPolicy in `syncbay-existing-catalog-copy.ts` con test esaustivi sulle union. Spostare la sezione UI in `ExistingCatalogTakeoverSection.tsx`, usando solo `s-*` e il contratto `ExistingCatalogTakeoverReport`.

- [x] **Step 4: Imporre obiettivi di profondità/locality**

A fine Task 10:

- `app.import-preview.tsx` deve scendere sotto 1.500 righe;
- nessun nuovo modulo deve superare 800 righe;
- `syncbay.server.ts` deve perdere almeno il verticale takeover completo;
- route e fixture devono importare il tipo da `app/lib`, non ricostruirlo manualmente.

Non spezzare file per sola metrica: ogni modulo nuovo deve possedere una responsabilità completa.

- [x] **Step 5: Verificare e committare**

Run:

```bash
npm run test:runtime
npm run coverage:lib
npm run typecheck
npm run lint
npm run build
npm run smoke:ui
wc -l app/routes/app.import-preview.tsx app/services/syncbay.server.ts app/services/existing-catalog-takeover.server.ts
```

Expected: gate verdi e obiettivi di locality rispettati.

```bash
git add app/services/existing-catalog-takeover.server.ts app/services/existing-catalog-takeover.server.test.ts app/components/ExistingCatalogTakeoverSection.tsx app/lib/syncbay-existing-catalog-copy.ts app/lib/syncbay-existing-catalog-copy.test.ts app/services/syncbay.server.ts app/routes/app.import-preview.tsx app/lib/syncbay-existing-catalog-takeover.ts
git commit -m "refactor: deepen existing catalog takeover"
```

---

### Task 11: Trasformare il render fixture in un vero gate UI isolato

**Files:**
- Create: `scripts/syncbay-ui-fixtures.ts`
- Create: `scripts/syncbay-ui-check.mjs`
- Create: `scripts/syncbay-ui-check.test.mjs`
- Create: `scripts/syncbay-ui-browser-check.mjs`
- Create: `scripts/syncbay-ui-browser-check.test.mjs`
- Modify: `scripts/syncbay-ui-render.mjs:35-87,740-845`
- Modify: `scripts/smoke-ui.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: contratti reali dei loader e `ExistingCatalogTakeoverReport` del Task 10.
- Produces: `npm run ui:check` e `npm run ui:browser-check`: render SSR e hydration browser delle sei superfici e dei loro stati principali senza `.env`, rete, HMR o screenshot obbligatori. Gli script di render vengono eseguiti con `tsx`, così possono importare le fixture TypeScript senza un secondo formato duplicato.

- [x] **Step 1: Scrivere test rossi di isolamento**

I test devono spawnare `npm run ui:render -- panoramica --fixture --check` con una env sentinella e verificare:

```ts
assert.match(stderr, /env: fixture isolata; 0 variabili runtime caricate/);
assert.doesNotMatch(stderr, /EADDRNOTAVAIL|TOKEN_ENCRYPTION_KEY|DATABASE_URL/);
assert.equal(exitCode, 0);
```

Testare anche `importazione` per riprodurre il rosso corrente su `fieldPolicy` prima della correzione fixture.

- [x] **Step 2: Analizzare argomenti prima di caricare l'ambiente**

Spostare:

```js
const args = process.argv.slice(2);
const fixtureMode = args.includes("--fixture");
const checkMode = args.includes("--check");
```

prima di `loadEnvFile`. Se `fixtureMode` è true:

- non leggere `.env` o `.env.shopify`;
- usare solo placeholder sintetici;
- disabilitare HMR/WebSocket;
- non inizializzare loader reali;
- con `--check`, renderizzare HTML in memoria e non creare PNG.

- [x] **Step 3: Rendere tipizzate le fixture**

Spostare le factory in `syncbay-ui-fixtures.ts`. Costruire `existingCatalogTakeover` chiamando `buildExistingCatalogTakeoverReport` oppure usando `satisfies ExistingCatalogTakeoverReport`; non scrivere più righe manuali senza `fieldPolicy`.

Ogni pagina espone fixture tipizzate almeno per `healthy`, `empty`, `loading`, `degraded` ed `error`; Importazione aggiunge `blocked` e `in_progress`. La fixture Attività deve usare badge coerenti con il suo stato: un catalogo non allineato non può risultare contemporaneamente `Ok` senza una spiegazione esplicita. Gli stati sintetici verificano CTA successiva, retry, messaggio di errore e assenza di dettagli tecnici o segreti.

- [x] **Step 4: Creare il comando aggregato e aggiungerlo alla CI**

`syncbay-ui-check.mjs` esegue in sequenza:

```js
const pages = [
  "panoramica",
  "catalogo",
  "conflitti",
  "importazione",
  "attivita",
  "impostazioni",
];
```

per ciascuna pagina con `--fixture --check`, fallendo al primo exit non-zero.

Aggiungere:

```json
"ui:render": "tsx scripts/syncbay-ui-render.mjs",
"ui:check": "tsx scripts/syncbay-ui-check.mjs",
"ui:browser-check": "node scripts/syncbay-ui-browser-check.mjs"
```

`ui:browser-check` avvia il render fixture isolato e usa Playwright Chromium senza rete esterna. Deve fallire per `pageerror`, warning hydration, errore console inatteso, controllo senza nome accessibile, focus invisibile, ordine tastiera bloccato o overflow dell'intero documento. Esegue le sei pagine a `1440`, `1024`, `768` e `390px`, più zoom browser `200%`; l'overflow è ammesso soltanto nei wrapper esplicitamente scrollabili. Verifica anche `aria-live`, `aria-busy`, `prefers-reduced-motion`, ritorno del focus dopo navigazione/submit e che colore/icone non siano l'unico canale dello stato. Non dichiarare conformità WCAG completa né copertura screen reader: contrasto reale, albero di accessibilità nativo, tastiera e zoom `400%` restano QA manuale nel Task 13.

In CI mantenere `smoke:ui` come controllo statico branding e aggiungere step separati `npm run ui:check` e `npm run ui:browser-check`.

- [x] **Step 5: Verificare e committare**

Run:

```bash
node --test scripts/syncbay-ui-check.test.mjs
npm run ui:check
npm run ui:browser-check
npm run smoke:ui
npm run test:runtime
npm run typecheck
npm run lint
npm run build
```

Expected: matrice SSR e browser verde; nessun caricamento env reale, rete, `EADDRNOTAVAIL`, errore hydration o console; Importazione non lancia più `Cannot read properties of undefined (reading 'handle')`; stati vuoti/degradati/errore restano comprensibili e azionabili.

```bash
git add scripts/syncbay-ui-fixtures.ts scripts/syncbay-ui-check.mjs scripts/syncbay-ui-check.test.mjs scripts/syncbay-ui-browser-check.mjs scripts/syncbay-ui-browser-check.test.mjs scripts/syncbay-ui-render.mjs scripts/smoke-ui.mjs package.json .github/workflows/ci.yml
git commit -m "test: add isolated UI render gate"
```

---

### Task 12: Correggere UI live, budget frontend/provider e igiene documentale

**Files:**
- Verify: `app/routes/app.settings.tsx:586-632`
- Modify: `app/routes/app._index.tsx:246-367`
- Modify: `app/routes/app.catalog.tsx:144-176`
- Modify: `app/routes/app.conflicts.tsx:192-231,342-357`
- Modify: `app/routes/app.import-preview.tsx:819-855,1056-1088`
- Modify: `app/routes/app.activity.tsx:173-205`
- Modify: `app/routes/app.settings.tsx:343-365,442-461`
- Modify: `app/lib/syncbay-ui-state.ts`
- Modify: `app/lib/syncbay-ui-state.test.ts`
- Create: `app/lib/syncbay-runtime-log.ts`
- Create: `app/lib/syncbay-runtime-log.test.ts`
- Modify: `app/lib/syncbay-loader-performance.ts`
- Modify: `app/lib/syncbay-loader-performance.test.ts`
- Modify: `app/routes/api.jobs.run-due.tsx`
- Modify: `app/routes/webhooks.products.update.tsx`
- Modify: `app/routes/webhooks.inventory_levels.update.tsx`
- Modify: `app/styles/syncbay-embedded.css:1025-1086`
- Create: `public/robots.txt`
- Create: `scripts/syncbay-bundle-budget.mjs`
- Create: `scripts/syncbay-bundle-budget.test.mjs`
- Create: `scripts/syncbay-docs-check.mjs`
- Create: `scripts/syncbay-docs-check.test.mjs`
- Modify: `scripts/smoke-ui.mjs`
- Modify: `scripts/syncbay-ui-check.test.mjs`
- Modify: `package.json`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/CONTEXT.md`
- Modify: `docs/INDEX.md`
- Modify: `docs/TOOLCHAIN.md`
- Modify: `docs/DECISIONS_PENDING.md`
- Modify: `docs/glossario.md`
- Modify: `docs/guides/provisioning-runtime.md`
- Modify: `docs/guides/sicurezza-privacy.md`
- Modify: `SECURITY.md`
- Modify: `CHANGELOG.md`
- Verify: `CLAUDE.md`
- Verify: `.mex/ROUTER.md`
- Modify: `.mex/context/setup.md`

**Interfaces:**
- Consumes: stato finale dei Task 1-11.
- Produces: gate React Doctor ancora a `100/100`, stati UI coerenti e accessibili, raccolte di box monocolonna su mobile e bilanciate senza buchi su desktop, overflow confinato, payload e log osservabili senza rumore, budget bundle/provider, crawler policy e documentazione verificabile.

- [x] **Step 1: Verificare che il fix React Doctor già rilasciato non regredisca**

Checkpoint chiuso per decisione del maintainer: il run è stato escluso da Task
12. La branch è stata ribasata sulla PR #445, che contiene il fix dedicato, ma
Task 12 non dichiara una nuova esecuzione di React Doctor.

La base `1.0.45` contiene già:

```ts
const selectedPublicationIdSet = new Set(selectedPublicationIds);
```

e usa già:

```tsx
defaultChecked={selectedPublicationIdSet.has(publication.id)}
```

Non modificare nuovamente `app.settings.tsx` salvo regressione dimostrata. Run: `npm run quality:react-doctor`

Expected: `100/100`, nessun warning `Array lookup inside a loop`.

- [x] **Step 2: Aggiungere una policy crawler minima**

Creare `public/robots.txt`:

```text
User-agent: *
Disallow: /app/
Disallow: /auth/
Disallow: /api/
Disallow: /webhooks/
```

Aggiungerlo ai file pubblici verificati da `smoke-ui.mjs`.

- [x] **Step 3: Bilanciare le griglie di box su mobile e desktop**

Avvolgere con `<div className="syncbay-balanced-box-grid">` le `s-grid` che contengono card, metriche o pannelli affiancati. Per il solo gruppo di tre metriche compatte della Panoramica aggiungere anche `syncbay-balanced-box-grid--compact-three`. Per `syncbay-existing-catalog-grid`, aggiungere la nuova classe al wrapper già presente senza crearne un secondo:

- le metriche e le due sezioni operative di Panoramica;
- le metriche Catalogo;
- le metriche e il confronto eBay/Shopify dei Conflitti;
- le metriche import e catalogo esistente di Importazione;
- le metriche Attività;
- le card e le metriche interne di Impostazioni.

Non applicare la classe a griglie interne usate soltanto per allineare label, pulsanti, campi form o il pulse eBay-Shopify.

In `app/styles/syncbay-embedded.css` aggiungere:

```css
.syncbay-balanced-box-grid > s-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
}

.syncbay-balanced-box-grid > s-grid > * {
  min-inline-size: 0;
}

.syncbay-balanced-box-grid > s-grid > :last-child:nth-child(odd) {
  grid-column: 1 / -1;
}

@media (min-width: 1100px) {
  .syncbay-balanced-box-grid--compact-three > s-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  }

  .syncbay-balanced-box-grid--compact-three > s-grid > :last-child:nth-child(odd) {
    grid-column: auto;
  }
}

@media (max-width: 640px) {
  .syncbay-balanced-box-grid > s-grid {
    grid-template-columns: minmax(0, 1fr) !important;
  }

  .syncbay-balanced-box-grid > s-grid > :last-child:nth-child(odd) {
    grid-column: auto;
  }
}
```

In `scripts/syncbay-ui-check.test.mjs`, per ciascuna delle sei fixture, verificare che l'HTML contenga almeno una griglia marcata:

```js
assert.match(html, /syncbay-balanced-box-grid/);
```

In `scripts/smoke-ui.mjs` verificare la classe, le due colonne desktop di Impostazioni, l'eccezione Panoramica a tre colonne e la regola monocolonna mobile sul contenitore reale. Expected: su mobile ogni box occupa una riga; su desktop Impostazioni è `2 x 2`, Conflitti conserva i cinque riepiloghi sulla stessa riga quando lo spazio lo consente e Panoramica mantiene tre metriche compatte solo quando c'è spazio reale.

- [x] **Step 4: Correggere layout e overflow riprodotti sullo store Numisleo**

Applicare le correzioni confermate dall'audit embedded in sola lettura:

1. Impostazioni: quattro card commerciali in `2 x 2` desktop e una colonna mobile, senza slot vuoti; diagnostica tecnica e azioni distruttive restano nei disclosure esistenti;
2. Conflitti: mantenere i cinque riepiloghi sulla stessa riga desktop quando lo spazio lo consente, senza allargare l'ultimo; usare una colonna mobile;
3. Catalogo: filtri/chip possono andare a capo; la tabella a otto colonne vive in un wrapper `max-inline-size: 100%; overflow-x: auto`; `s-page`, sezioni e griglie restano a `min-inline-size: 0`, quindi lo scroll orizzontale non trascina l'intera app embedded;
4. tutte le superfici: nessun testo, controllo o badge tagliato a `1440px`, `1024px`, `768px` e `390px`; touch target e focus restano nativi Shopify.

Il test browser deve confrontare `document.documentElement.scrollWidth` con `clientWidth`: è ammesso overflow solo nel wrapper della tabella Catalogo. Le fixture restano sintetiche; lo store Numisleo serve solo da riferimento visivo read-only e non produce screenshot versionati.

- [x] **Step 5: Rendere coerenti stati, metriche e microcopy operative**

Estendere `syncbay-ui-state.ts` con un modello condiviso che separa:

- esito del job: `succeeded | failed | retrying`;
- salute catalogo: `aligned | catching_up | delayed | error | disabled`;
- attività del runner: `running | waiting | stopped`.

Scrivere prima test rossi che impediscano le combinazioni osservate live:

- un evento `Completata` non può avere badge `Ok` e testo “catalogo non ancora allineato” senza stato catalogo `catching_up` esplicito;
- `Non disponibile` non compare accanto a `Ok`: il dato assente usa “Dato non disponibile” neutro, senza semantica di successo;
- nessun job attivo con prossimo controllo pianificato si presenta come `Fermo`: usare “In attesa del prossimo controllo”;
- prodotti seguiti, eBay attivi ed esauriti hanno label distinte e una relazione aritmetica verificata con fixture sintetiche; “Prodotti collegati” non cambia denominatore tra Panoramica, Catalogo e Impostazioni;
- “0 sincronizzati nelle ultime 24h” e “2.000 sincronizzazioni negli ultimi 7 giorni” dichiarano se contano prodotti, job o run e non si contraddicono;
- note duplicate dello stesso job/minuto sono raggruppate in una riga con conteggio e disclosure, senza nascondere errori o retry.

Le route consumano il modello condiviso; non duplicare ternari di stato. Aggiornare il glossario UI in `docs/glossario.md`.

- [x] **Step 6: Semplificare l'Importazione senza cambiare il flusso**

Quando eBay è collegato, mostrare lo stato sano e spostare `Ricollega eBay` dentro un disclosure “Gestisci collegamento”; l'azione principale resta “Aggiorna preview live”. La rinomina location non deve competere con preview/import: lasciarla nelle Impostazioni o in un disclosure avanzato, mentre scelta e conferma location restano nel passo di preparazione. Non eseguire automaticamente preview, OAuth, import o apply all'apertura.

- [x] **Step 7: Aggiungere budget bundle e rendering**

Creare `bundle:budget` senza nuove dipendenze. Dopo `npm run build`, misurare gzip e fallire oltre soglie con margine rispetto alla baseline fresca:

- JS client totale: `180 kB` gzip;
- singola route UI: `12 kB` gzip;
- CSS embedded: `5 kB` gzip;
- server bundle: `230 kB` gzip.

Il test usa una directory temporanea con file sintetici e verifica exit `0/2`; non dipende dagli hash Vite. Le soglie non sono obiettivi da riempire: una crescita motivata richiede misura, nota nel changelog e aggiornamento esplicito del budget.

- [x] **Step 8: Strutturare osservabilità e budget dei payload senza aumentare il rumore**

Creare un logger server condiviso con envelope allowlistato:

```ts
type RuntimeLogEvent = {
  event: string;
  level: "info" | "warn" | "error";
  requestId: string | null;
  route: string;
  durationMs?: number;
  payloadBytes?: number | null;
  outcome?: string;
};
```

Usare `x-vercel-id` o un ID generato non sensibile come correlazione tra route, runner e webhook. Vietare payload provider, titoli, SKU, shop domain, token e stack completi nei log normali. Il logger deve:

- registrare sempre errori, timeout e richieste sopra soglia;
- campionare al massimo il `5%` delle richieste sane in production, mantenendo test/dev completi;
- produrre JSON a riga singola interrogabile nei Runtime Logs Hobby, senza introdurre drain o servizio esterno;
- raggruppare gli eventi runner con `processedCount`, `failedCount`, `elapsedMs` e `continuationNeeded` aggregati.

Riutilizzare `logSyncBayLoaderPerformance`, che già misura `payloadBytes`, invece di creare una seconda telemetria. Aggiungere budget iniziali verificati con fixture massime: `128 KiB` per Panoramica/Attività/Impostazioni e `256 KiB` per Catalogo/Conflitti/Importazione. Warning all'80%, errore del gate oltre soglia; non troncare silenziosamente dati necessari alla UI. In production loggare i loader sani solo per campione o quando `totalMs > 1.000`, mentre errori e payload oltre budget restano sempre visibili.

Speed Insights e Web Analytics sono già installati: verificare che non vengano duplicati e includere i loro data point/eventi nel budget Vercel. Non aggiungere Sentry, drain o nuova dipendenza in questa fase.

- [x] **Step 9: Rimuovere disaster recovery dal perimetro**

Per decisione del maintainer del 16 luglio 2026, SyncBay non implementa né
documenta backup o restore del database. Rimossi script, comandi, env, test e
runbook dedicati. Baseline, checkpoint e rollback applicativo restano nel loro
perimetro e non vengono presentati come disaster recovery.

- [x] **Step 10: Rendere verificabile la documentazione e la pulizia generale**

Creare `docs:check` senza nuove dipendenze per verificare link Markdown relativi, anchor principali, file indicizzati in `docs/INDEX.md`, comandi `npm run` citati e assenza di file generati/temporanei tracciati. Il cleanup include:

```json
"docs:check": "node scripts/syncbay-docs-check.mjs"
```

- `.DS_Store`, `build/`, cache, preview, dump, export e screenshot reali fuori Git;
- `TODO`/`FIXME` classificati in backlog oppure rimossi se superati;
- script senza voce in `package.json` o senza documentazione operativa;
- duplicati palesi in CSS, microcopy e documenti canonici;
- `console.*` ad hoc sostituiti dal logger strutturato o motivati nei soli entrypoint framework.

- [x] **Step 11: Riallineare roadmap e documenti canonici**

Aggiornamenti obbligatori:

- rimuovere dalla sezione `Ora` della roadmap il catalogo esistente già implementato;
- promuovere freschezza conflitti, cifratura sessioni e budget storage come completati dopo i rispettivi rollout;
- indicare `limit=2` una sola volta nella guida provisioning;
- documentare baseline/checkpoint e test server/UI reali;
- documentare budget provider Free, significato delle metriche UI e limiti di osservabilità del piano corrente;
- documentare payload/log sampling, Core Web Vitals disponibili, accessibilità verificata e limiti manuali residui;
- aggiornare sicurezza da “storage template da decidere” a token Shopify cifrati;
- aggiungere il nuovo piano a `docs/INDEX.md`;
- classificare le modifiche runtime nel changelog come patch.

- [x] **Step 12: Verificare i rilievi classificati come non-azione**

Run:

```bash
npm outdated --json
npm run db:verify
```

Expected:

- React Router 8, TypeScript 7 e tipi Node 26 restano major intenzionalmente escluse; eventuali nuove patch/minor compatibili vengono classificate in un filone dipendenze separato, senza allargare questa ondata;
- gli indici Supabase segnalati come `unused` restano in sede: non rimuoverli senza almeno 30 giorni di statistiche e controllo dei percorsi auth/OAuth;
- nessun advisor sicurezza Supabase;
- nessun redesign generale: le sei superfici e la microcopy italiana restano la base.

- [x] **Step 13: Riallineare lo scaffold mex senza duplicare le regole canoniche**

Run:

```bash
npx mex-agent check
npx mex-agent sync --dry-run
```

Aggiornare `.mex/context/setup.md` con i comandi runtime, test e manutenzione realmente introdotti dal programma. Verificare che `CLAUDE.md` continui a delegare ad `AGENTS.md` invece di copiarne il contenuto e che `.mex/ROUTER.md` descriva lo stato 1.0 effettivo. Correggere drift sostanziale; se mex segnala ancora come stale il thin wrapper `CLAUDE.md` pur essendo coerente, registrare l'eccezione nel riepilogo invece di duplicare centinaia di righe.

- [x] **Step 14: Verificare e committare**

Run:

```bash
npm run quality:react-doctor
npm run smoke:ui
npm run ui:check
npm run ui:browser-check
npm run typecheck
npm run lint
npm run build
npm run bundle:budget
npm run provider:budget
npm run docs:check
npx mex-agent check --quiet
git diff --check
```

Expected: gate applicativi verdi, stati semantici/accessibili coerenti, hydration senza errori, griglie bilanciate, nessun overflow pagina, bundle e payload nei budget, log strutturati e campionati, quote provider osservate oppure classificate con uno stato causale e azionabile, documentazione/link/comandi coerenti, `robots.txt` incluso nello smoke e mex con zero errori.

```bash
git add app/routes/app._index.tsx app/routes/app.catalog.tsx app/routes/app.conflicts.tsx app/routes/app.import-preview.tsx app/routes/app.activity.tsx app/routes/app.settings.tsx app/routes/api.jobs.run-due.tsx app/routes/webhooks.products.update.tsx app/routes/webhooks.inventory_levels.update.tsx app/lib/syncbay-ui-state.ts app/lib/syncbay-ui-state.test.ts app/lib/syncbay-runtime-log.ts app/lib/syncbay-runtime-log.test.ts app/lib/syncbay-loader-performance.ts app/lib/syncbay-loader-performance.test.ts app/styles/syncbay-embedded.css public/robots.txt scripts/syncbay-bundle-budget.mjs scripts/syncbay-bundle-budget.test.mjs scripts/syncbay-docs-check.mjs scripts/syncbay-docs-check.test.mjs scripts/smoke-ui.mjs scripts/syncbay-ui-check.test.mjs package.json docs/ROADMAP.md docs/CONTEXT.md docs/INDEX.md docs/TOOLCHAIN.md docs/DECISIONS_PENDING.md docs/guides/provisioning-runtime.md docs/guides/sicurezza-privacy.md docs/glossario.md SECURITY.md CHANGELOG.md .mex/context/setup.md
git add -u CLAUDE.md .mex/ROUTER.md
git commit -m "fix: align UI states and operational budgets"
```

---

### Task 13: Verifica completa, release, deploy e chiusura del programma

**Files:**
- Verify: all files changed by Task 1-12
- Modify when required by release: `app/lib/version.ts`
- Modify when required by release: `CHANGELOG.md`
- Verify: `docs/superpowers/plans/2026-07-10-syncbay-comprehensive-improvement.md`

**Interfaces:**
- Consumes: tutte le ondate completate e i rollout live verificati.
- Produces: release private `1.0.x` verificata, deploy production sano, provider stabili e matrice audit completamente chiusa.

- [x] **Step 1: Eseguire il gate locale completo in sequenza**

Non parallelizzare `prisma:generate`, test e build.

```bash
npm ci
npm run prisma:generate
npm run doctor:local
npm run test:runtime
npm run coverage:lib
npm run typecheck
npm run lint
npm run build
npm run bundle:budget
npm run prisma:validate
npm run ui:check
npm run ui:browser-check
npm run smoke:ui
npm run quality:react-doctor
npm run audit:prod
npm run db:verify
npm run db:storage-budget
npm run provider:budget
npm run docs:check
npx mex-agent check --quiet
```

Expected: tutti exit `0`; `db:storage-budget` resta sotto 400 MB (`warning` ammesso ma dichiarato), `provider:budget` non ha metriche in fascia urgente/blocco e non presenta dati mancanti come verdi. Mex deve avere zero errori e nessun warning non già classificato nel Task 12.

Eseguito il 16 luglio 2026 dopo riallineamento a `origin/main`: full gate verde,
coverage `95,42%` linee / `83,28%` branch, bundle nei budget, database
`306,1 MiB`, React Doctor `100/100` sul diff. Mex resta `94/100` con i due
warning già classificati nel Task 12: wrapper `CLAUDE.md` intenzionalmente
stale e confronto testuale con `AGENTS.md`, senza drift sostanziale delle regole.

- [x] **Step 2: Eseguire self-review e controllo di copertura**

```bash
npm run review:pre-pr -- --base origin/main
git diff --check
git status --short
```

Rileggere la tabella “Mappa unica” e associare a ogni riga almeno un test, un diff e una verifica live. Nessun rilievo può essere chiuso solo perché build/CI sono verdi.

- [x] **Step 3: Eseguire preflight GitHub**

Usare il percorso GitHub che espone in modo più completo check-run, review thread e stato PR; `gh` e connector sono entrambi ammessi.

```bash
npm run publish:preflight -- --remote
```

Expected: PR corrente pronta, titolo Conventional Commit, nessun thread Codex actionable sulla PR e check obbligatori verdi.

Eseguito sulla PR `#469`: titolo Conventional Commit, preflight remoto pulito
e `9` check conclusi con successo, inclusi CI proporzionata, CodeQL, React
Doctor `100/100`, Vercel e controllo titolo. La PR è stata squash-mergeata nel
commit `0d93304`.

- [x] **Step 4: Preparare la release solo se esistono cambi non ancora rilasciati**

```bash
npm run release:dry-run
```

Se `[Non rilasciato]` contiene cambi runtime versionati, eseguire `npm run release -- --bump patch`. Se l'ultima ondata ha già prodotto e pubblicato la propria patch e non restano cambi versionati, non creare una release vuota: verificare tag e GitHub Release esistenti. In entrambi i casi versione, changelog, tag `vX.Y.Z` e GitHub Release seguono ADR 0006/0008. Mergeare su `main`, pulire branch/worktree e confermare che il deploy automatico punti al commit mergeato.

- [x] **Step 5: Verificare Vercel production**

Con lo strumento Vercel che restituisce deployment, commit e log verificabili:

- deployment `READY` sul commit/tag corretto;
- smoke pubblico `/`, `/about`, `/privacy`, `/terms`, `/robots.txt` con HTTP `200`;
- nessun nuovo gruppo `5xx` o timeout nel deploy;
- per almeno 24 ore dopo il rollout nessuna ricorrenza di `timeout exceeded when trying to connect`, timeout di avvio transazione, `ECHECKOUTTIMEOUT`, “Prisma session storage is not ready”, deadlock o `FUNCTION_INVOCATION_TIMEOUT` sul runner;
- runner normalmente sotto `70 s`, senza invocazioni vicine a `300 s`;
- uso Vercel Free sotto le soglie 70/85/95% per invocazioni, CPU, memoria, transfer e build execution; deploy preview ridondanti classificati, senza disabilitare le preview utili;
- Speed Insights senza regressioni evidenti su LCP, INP, CLS e TTFB e relativi data point sotto quota; Web Analytics montata una sola volta e sotto quota eventi;
- log runtime JSON correlabili per `requestId`, errori/slow request sempre presenti e richieste sane campionate senza payload sensibili;
- il solo vecchio rumore `/robots.txt` non ricompare.

Verifica fresca del 16 luglio 2026: deployment production
`dpl_HBf7awL3UqexdfDRbrxD6HGpFVgD` `READY` sul commit `0d93304` e tag
`v1.0.71`; `audit:prod` pulito e smoke pubblici verdi. Il primo tick cron
successivo, alle `09:35 UTC`, ha risposto `200` in `1.295 ms`, con
`processedCount=0` e `failedCount=0`; il nuovo deployment non presenta gruppi
di errore. Il controllo ha rilevato un singolo `P2028` alle `09:20 UTC` sul
deployment precedente `v1.0.70`, non un cluster: resta dichiarato e non viene
presentato come finestra pulita di 24 ore. Per la precedente autorizzazione del
maintainer a superare i gate temporali residui, la nuova finestra non resta un
blocco; un'eventuale ricorrenza sul deployment `v1.0.71` riapre il rilievo.
Nella finestra precedente i tick runner osservabili erano al massimo
`26.818 ms`, senza campioni oltre `70 s`; lo storico cron Supabase conferma
zero run fallite nelle 24 ore.
Analytics usa `642/50.000` eventi su 30 giorni; Speed Insights espone
`16/10.000` data point nei 7 giorni disponibili, entrambi sotto quota.
Fast Data Transfer e metriche runtime restano `provider_locked` sul piano
Hobby: `provider:budget` le classifica con causa e azione dashboard, senza
presentarle come verdi o stimarle. Web Analytics e Speed Insights risultano
montate una sola volta.

- [x] **Step 6: Verificare Supabase e runner live**

Con lo strumento Supabase che copre health, query aggregate, advisor e cron, senza stampare dati sensibili:

- progetto `ACTIVE_HEALTHY`;
- advisor sicurezza vuoto;
- cron ogni 5 minuti, `limit=2`;
- job conflitto più vecchio sotto 15 minuti;
- nessun backlog monotonicamente crescente nelle 24 ore;
- mapping inventory indicizzati e nessuna collisione;
- zero token Shopify plaintext;
- baseline presenti per mapping attivi;
- maintenance giornaliera eseguita una volta;
- `cron.job_run_details` limitata agli ultimi 14 giorni;
- nessuna snapshot mappata cancellata senza checkpoint completo e ricostruzione rollback campionata con esito equivalente;
- database sotto 400 MB e crescita settimanale entro 5%;
- egress/cached egress Supabase, file storage e altre quote Free sotto la fascia urgente; nessun `402` o read-only;
- controllare il tick cron successivo al deploy e i log `5xx`.

Verifica fresca del 16 luglio 2026: progetto `ACTIVE_HEALTHY`, `db:verify`
senza finding e database `321.014.931` byte (`306,1 MiB`, stato `ok`). Il cron
attivo gira ogni 5 minuti e legge da Vault un URL con `limit=2`; la schedule
legacy è disattivata. Job dovuti più vecchi circa `6,4 min`, conflitti aperti
`0`, fallimenti nelle 24 ore `0`, backlog `DETECT_SHOPIFY_CHANGES` non
monotono (picco `10`, valore iniziale/finale `1`). Collisioni inventory,
mapping attivi senza baseline, checkpoint incompleti, snapshot mappate oltre
la retention senza checkpoint e token Shopify plaintext sono tutti `0`.
Maintenance riuscita due volte nelle 48 ore; storico cron più vecchio di 14
giorni `0`; storage file `0` oggetti/byte; API senza `402`, read-only o `5xx`.
L'egress provider non è esposto dalla CLI: resta `dashboard_required` con
diagnostica SQL osservata e senza stima presentata come consumo reale.

- [x] **Step 7: Verificare Shopify store pilota Numisleo e UI live**

Dentro Shopify Admin:

- aprire le sei superfici;
- verificare le sei superfici a `1440px`, `1024px`, `768px` e `390px`: desktop non monocolonna, Impostazioni `2 x 2`, cinque riepiloghi Conflitti sulla stessa riga quando lo spazio lo consente, una colonna mobile e nessun ultimo box forzato a tutta larghezza;
- confermare che la pagina embedded non abbia overflow orizzontale; nel Catalogo può scorrere soltanto il wrapper della tabella;
- verificare le semantiche live: nessun `Completata`/`Ok` associato a “non ancora allineato”, nessun `Fermo` con prossimo controllo pianificato e denominatori coerenti tra prodotti seguiti, attivi ed esauriti;
- verificare che Importazione tenga riconnessione e rinomina location secondarie rispetto a preview e prerequisiti;
- eseguire la matrice sintetica healthy/empty/loading/degraded/error e verificare tastiera, focus visibile, nomi accessibili, `aria-live`, reduced motion, zoom `200%` automatico e `400%` manuale; per decisione del maintainer del 16 luglio 2026 non usare VoiceOver: verificare i flussi principali tramite albero di accessibilità nativo e navigazione completa da tastiera, senza presentare l'esito come test screen reader;
- confermare assenza di errori hydration, `pageerror` e console inattesi;
- eseguire una modifica prodotto e una inventory controllata sullo store pilota Numisleo;
- confermare creazione e chiusura dei relativi job conflitto;
- non eseguire import/apply/takeover su store cliente senza un go dedicato;
- non effettuare scritture eBay salvo il runbook stock esplicitamente autorizzato.

Prova prodotto eseguita il 16 luglio 2026 sul mapping controllato già usato dai
test operativi: titolo modificato temporaneamente, webhook e job
`DETECT_SHOPIFY_CHANGES` riusciti, conflitto titolo aperto; dopo il ripristino
esatto del titolo originale il secondo job è riuscito e il conflitto è stato
risolto. Inventario rimasto a `28`; nessuna scrittura eBay.

Chiusura UI del 16 luglio 2026 sullo store reale Numisleo: le sei superfici
sono state verificate automaticamente a `1440/1024/768/390 px`, zoom `200%`,
contenitori embedded stretti e matrice healthy/empty/loading/degraded/error.
Il controllo manuale in Chrome autenticato a zoom esatto `400%` ha caricato
tutte le sei superfici senza overflow orizzontale dell'iframe; Impostazioni
resta `2 x 2` desktop, Conflitti mantiene cinque riepiloghi sulla stessa riga
quando lo spazio lo consente e il mobile resta monocolonna. Navigazione da
tastiera, focus e nomi accessibili sono presenti; VoiceOver non è stato usato
per decisione del maintainer. La consegna inventory controllata era già stata
eseguita con successo e accettata dal maintainer tramite Claude; non è stata
ripetuta. Nessun import/apply/takeover né scrittura eBay è stato eseguito.

- [x] **Step 8: Verificare la riduzione degli hotspot senza metric gaming**

Run:

```bash
wc -l app/services/sync-job-runner.server.ts app/services/syncbay.server.ts app/services/shopify-draft-import.server.ts app/routes/app.import-preview.tsx
find app/lib app/services app/components -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | xargs -0 wc -l | sort -nr | head -20
```

Expected: `app.import-preview.tsx` sotto 1.500 righe; runner, `syncbay.server.ts` e draft import hanno perso rispettivamente ownership conflitti, takeover e ciclo vita/retry import; nessun nuovo modulo supera 1.000 righe. Se una metrica resta alta, il task può chiudersi solo mostrando che il relativo verticale non è più disperso, non con split nominali.

Esito: `app.import-preview.tsx` è a `1.488` righe; i tre orchestratori storici
restano a `5.017`, `4.428` e `3.728` righe, ma delegano i verticali ai moduli
dedicati di conflitto, takeover ed esecuzione import. Nessun nuovo modulo
estratto supera `1.000` righe; il massimo nuovo owner è
`existing-catalog-takeover.server.ts` a `650`.

- [x] **Step 9: Chiusura e handoff**

Nel riepilogo finale riportare:

- release, commit, PR, tag, GitHub Release e deployment;
- migrazioni applicate;
- conteggi backlog/storage senza payload;
- test realmente eseguiti;
- esito accessibilità da albero nativo/tastiera/zoom, Core Web Vitals e payload/log budget;
- eventuali monitor 7 giorni ancora attivi;
- rischi residui concreti;
- conferma che App Store/billing/2.0 non sono stati avviati.

Chiusura pubblicata il 16 luglio 2026: PR `#469`, commit `0d93304`, release e
tag `v1.0.71`, GitHub Release pubblica e deployment production
`dpl_HBf7awL3UqexdfDRbrxD6HGpFVgD` `READY`. Nessuna migration nuova. Database
`306,1 MiB`; backlog conflitti aperti `0`, trend 24 ore non monotono e storage
file `0` byte. Gate completo fresco verde: `125` test tooling, `630` test lib,
`43` test servizi, coverage `95,42%` linee / `83,28%` branch, typecheck, lint,
build, Prisma, bundle, `32` scenari SSR, browser `6 x 4`, audit produzione,
advisor e budget provider. Verifica Numisleo tramite albero accessibile,
tastiera, zoom automatico `200%` e Chrome manuale `400%`; VoiceOver escluso.
Le quote non esposte restano classificate `provider_locked` o
`dashboard_required`; il monitor temporale post-release è stato rinunciato per
decisione esplicita, non dichiarato come trascorso. App Store, billing e
perimetro 2.0 non sono stati avviati.

---

## Matrice finale di copertura dell'audit

| Punto emerso | Chiusura richiesta |
| --- | --- |
| 547 job conflitto dovuti e oldest dal 5 luglio | Task 2/4 + oldest <15 minuti e trend 24h non crescente |
| 0 conflitti aperti potenzialmente non fresco | Task 4 + distinzione tra conflitti, no-op e mapping mancanti |
| Priorità runner fissa con `limit=2` | Task 2, senza aumento cieco del limite |
| 7 giorni senza job inventory osservati | Task 3 + verifica registrazione/consegna store pilota Numisleo |
| Lookup inventory sulle ultime 300 snapshot | Task 3, lookup indicizzato diretto |
| Token Shopify plaintext | Task 5/6, zero plaintext live |
| Refresh HTTP dentro transazione `FOR UPDATE` | Task 6, read/network/CAS |
| Retry Shopify annidati teorici 4 x 4 | Task 6, massimo 4 fetch totali |
| Database 346 MB / 500 MB | Task 7/8/13, budget sotto 400 MB |
| Ricontrollo DB a 370.363.539 byte, 19.613 snapshot e 39.705 audit/7d | Task 8/13, delta settimanale e soglie 350/400/450 MB |
| `AuditLog`, `ProductSnapshot`, `SyncJob` dominanti | Task 7/8, baseline + checkpoint + retention differenziata |
| Retention con otto delete a ogni tick | Task 8, maintenance una volta al giorno |
| `cron.job_run_details` senza cleanup automatico | Task 8/13, retention 14 giorni |
| Incidenti storici pool/transaction/session e timeout runner 300 s | Task 2/4/13, deadline 70 s, intake breve e finestra 24h pulita |
| File runtime da 4-5 mila righe | Task 4/6/9/10, moduli profondi e locality misurata |
| Solo tre test server e nessun gate CI | Task 1, `test:services`/`test:runtime` |
| Job import esterno e interno | Task 9, un solo proprietario |
| Fixture Importazione senza `fieldPolicy` | Task 10/11, contratto condiviso |
| `smoke:ui` statico falso verde | Task 11, `ui:check` SSR |
| Fixture carica `.env` e apre HMR non locale | Task 11, isolamento completo |
| Warning React Doctor `includes` nel loop | Già risolto dalla base `1.0.45`; Task 12/13 mantengono il gate `100/100` |
| `/robots.txt` 404 nei log | Task 12, file statico + smoke |
| Roadmap e guida cron stale | Task 2/12, fonti canoniche riallineate |
| Impostazioni dense | Task 12, QA live e disclosure solo tecnico; nessun redesign senza evidenza |
| Cinque card Conflitti troppo strette e box dispari | Vincolo globale + Task 12/13, mobile monocolonna, desktop bilanciato senza buchi e QA a quattro breakpoint |
| Catalogo live da 50 righe/8 colonne con overflow | Task 12/13, scroll confinato alla tabella e nessun overflow dell'iframe |
| Attività live contraddittoria e metriche con denominatori ambigui | Task 11/12/13, modello semantico condiviso e glossario |
| Importazione con azioni secondarie troppo prominenti | Task 12/13, disclosure collegamento e rinomina location avanzata |
| Bundle client `149.035` byte gzip e server `181,9 kB` gzip | Task 12/13, budget automatico 180/230 kB |
| Quote Vercel/Supabase Free oltre la sola size DB | Task 8/12/13, soglie 70/85/95%, stati mancanti causali e mai verdi |
| Nessun gate hydration/accessibilità e soli happy path fixture | Task 11/12/13, state matrix, Playwright, tastiera/focus/zoom e albero di accessibilità nativo; VoiceOver escluso su richiesta del maintainer |
| Loader con payload misurato ma senza budget, log sani non campionati | Task 12/13, soglie payload, sampling 5% e correlazione `requestId` |
| Analytics/Speed Insights già presenti ma non inclusi nel budget | Task 8/12/13, nessun doppio mount e consumo data point/eventi monitorato |
| `egress:budget` già esistente | Task 8, riuso obbligatorio dentro `provider:budget`, nessun duplicato |
| Pulizia generale non automatizzata | Task 12, `docs:check`, file temporanei, TODO/FIXME, script e `console.*` censiti |
| Tre indici Supabase INFO unused | Task 12, osservare 30 giorni; nessuna rimozione cieca |
| Mex a `76/100` con 8 warning preesistenti | Task 12, documentare i comandi nuovi, correggere drift sostanziale e spiegare eventuali warning intenzionali |
| React Router 8, TypeScript 7, Node types 26 | Esclusioni esplicite; migrazioni separate, non difetti di questo programma |
| Deploy/provider attualmente sani | Task 13 li usa come baseline; nessun “fix outage” inventato |

## Controllo di copertura eseguito prima della chiusura del piano

Il confronto finale tra questo documento, il thread di revisione e `/tmp/syncbay-architecture-review-20260710-095510.html` produce questa corrispondenza completa:

| Fonte verificata | Contenuto | Copertura nel piano |
| --- | --- | --- |
| HTML 1 — conflitti e fairness, indicato come prima scelta | Coalescenza, baseline batch, decisioni dichiarative, stock prioritario e corsia conflitti | Task 2-4; Ondata B |
| HTML 2 — adapter Shopify Admin/sessioni | Retry unici, budget temporale, refresh fuori transazione, CAS e token cifrati | Task 5-6; Ondata C |
| HTML 3 — ciclo vita import | Runner unico proprietario, risultato dichiarativo e audit senza secondo job | Task 9; Ondata E |
| HTML 4 — storia baseline prodotto | Baseline durevole, storia recente densa, checkpoint compatti e budget storage | Task 7-8; Ondata D |
| HTML 5 — catalogo Shopify esistente | Verticale condiviso tra preview, policy, apply, route e fixture tipizzata | Task 10-11; Ondata E, dopo conflitti e adapter come richiesto dal report |
| Thread — prove operative | Backlog `547`, soli `20/6.445` conflitti, assenza job inventory, crescita DB da circa `346 MB` a `370.363.539` byte, tabelle dominanti, incidente Vercel storico non corrente, `robots.txt` 404 | Sezione Baseline; Task 2-4, 7-8, 12-13 |
| Thread — qualità e test | Coverage attuale alta ma limitata a `app/lib`, test server fuori CI, runner Node nativo incompatibile, `tsx` verificato | Task 1 e gate finali Task 13 |
| Thread — UI reale e audit Numisleo Computer Use | Smoke statico falso verde, `fieldPolicy` mancante, env/HMR nella fixture; live: Attività semanticamente incoerente, Catalogo con overflow, Conflitti troppo stretti, Importazione sovraccarica e Impostazioni sbilanciate | Task 10-12 e verifica embedded a 1440/1024/768/390px nel Task 13 |
| Thread — performance e limiti Free | Bundle fresco contenuto, timeout runner storico, crescita storage, egress/build/invocation da governare | Task 2, 4, 8, 12, 13 |
| Passata finale — accessibilità, stati degradati e osservabilità | Gate browser/hydration, payload/log sampling e riuso egress budget | Task 8, 11-13 |
| Thread — debito minore e non-azioni | Warning React Doctor già chiuso in `1.0.45`, docs stale, major dipendenze intenzionali, indici `unused` da non rimuovere alla cieca, nessun outage corrente | Task 12-13 ed esclusioni globali |
| Thread — concentrazione architetturale | Quattro hotspot da circa 1.900-4.980 righe e ownership disperse | Task 4, 6, 9, 10 e controllo hotspot Task 13 |

Esito del controllo: tutti i rilievi validati hanno un task, un criterio di prova e, quando toccano runtime o dati, una verifica live. L'audit Numisleo è stato read-only: nessuna preview live, OAuth, import, apply, salvataggio o modifica prodotto è stata eseguita. Gli elementi osservati ma non dimostrati come bug — indici `unused`, major dipendenze e provider attualmente sani — sono coperti come verifiche o non-azioni esplicite, non trasformati in refactor arbitrari.

## Passata finale per area richiesta

| Area | Copertura definitiva | Prova di chiusura |
| --- | --- | --- |
| UI | Stati semantici condivisi, gerarchia Importazione, card e microcopy Numisleo | Task 11-13, fixture state matrix e QA embedded |
| Frontend | Hydration browser, bundle e payload budget, pending/error state, React Doctor | Task 11-13, `ui:browser-check`, `bundle:budget` e gate runtime |
| Impaginazione | Mobile monocolonna; desktop bilanciato non monocolonna; overflow confinato | Vincolo globale, Task 12 e quattro breakpoint live |
| Usabilità | CTA successiva, empty/degraded/error, retry, tastiera, focus, zoom e albero accessibilità | Task 11-13, automatico più verifica manuale dichiarata; nessun claim screen reader |
| Pulizia generale | File temporanei, TODO/FIXME, script, CSS/copy duplicata, `console.*`, link e indice docs | Task 12, `docs:check` e self-review |
| Bugfix | Tutti i rilievi HTML, inventory lookup, fixture `fieldPolicy`, stati contraddittori, `robots.txt` | Task 2-6 e 9-13 con test rossi e riproduzione |
| Stabilità | Fairness/deadline, pool DB, retry/CAS e job lifecycle | Task 2-9, 12-13 e monitor post-deploy |
| Performance | Batch conflitti, storia compatta, payload/bundle, loader timing, sampling log e CWV | Task 2, 4, 7-8, 11-13 |
| Vercel/Supabase Free | Storage/egress/invocation/CPU/memoria/transfer/build/analytics e soglie | Task 8, 12-13; stati osservati o causali non verdi e nessun bypass |
| Documentazione | ADR, roadmap, contesto, glossario, toolchain, sicurezza, mex e link/comandi | Task 2, 5, 7-8, 12-13 e `docs:check` |

Questa tabella è la checklist di accettazione del piano: un'area non è chiusa se manca una prova indicata nella terza colonna, anche con CI verde.

## Criterio di completamento complessivo

Il programma è concluso solo quando tutti i Task 1-13 sono spuntati, ogni ondata runtime è stata pubblicata e verificata, la matrice finale non contiene righe senza evidenza e i monitor backlog/storage hanno superato le finestre indicate. Una CI verde da sola non chiude il piano.

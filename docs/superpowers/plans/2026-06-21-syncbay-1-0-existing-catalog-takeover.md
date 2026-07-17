# SyncBay 1.0 Existing Catalog Takeover Implementation Plan

**Goal:** Portare SyncBay a una release privata 1.0 completa e installabile prima di qualunque onboarding cliente, poi usare Numisleo come primo onboarding reale post-1.0 fino a SyncBay come unico gestore del flusso eBay.it -> Shopify.

**Architecture:** Non creare funzionalità Numisleo-specifiche dentro l'app: la capability resta generica e vive nel tab `Importazione` con la modalità `Collega catalogo esistente`, costruita sopra preview, matching conservativo, mapping, snapshot, import worker e policy di conflitto già esistenti. Il piano è separato in due gate: prima release privata `1.0.0` completa, verificata, taggata, deployata e installabile; dopo, onboarding Numisleo come primo cliente reale, con eventuali correzioni rilasciate come `1.0.1+`. Il takeover scrive solo dopo dry-run, conferma esplicita e claim del prodotto Shopify tramite metafield `syncbay` + `ProductMapping`; dopo il claim riusa il percorso ordinario di import/sync in modalità `reuseOnly`, così non crea duplicati.

**Tech Stack:** TypeScript, React Router, Shopify Web Components (`s-*`), Shopify Admin GraphQL, eBay Inventory/Trading API, Prisma/Postgres, Supabase Queues/Cron, Node test runner.

---

## Stato Verificato Task 0-8 (2026-07-01)

**Esito:** Task 0-8 sono completati al 100% per il perimetro previsto da questo
piano: audit read-only, fondazione generica, preview live, matching, report,
lettura Shopify paginata, apply `reuseOnly`, policy campi del takeover,
readiness privacy/termini e mini kit 1.0 privata. Questo non equivale a
release 1.0 completa, installazione, apply reale o go-live su Numisleo: Task 9
resta aperto prima di dichiarare `1.0.0`; Task 10-11 sono onboarding Numisleo
post-1.0.

**Base verificata:** `main` a `4bdfa3f`, PR mergeate #301, #324, #325, #329,
#330, #331, #332, #333, #335, #339 e #340, audit locale ignorato in
`audits/numisleo.myshopify.com/20260621-2239/`.

| Task   | Stato      | Evidenza                                                                                                                                                                                                                                                                                                                                                   | Limite esplicito                                                                                 |
| ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Task 0 | Completato | Audit read-only con report, riconciliazione, classificazione eccezioni, audit contenuti e freeze plan in `audits/numisleo.myshopify.com/20260621-2239/`; cartella audit ignorata dal repo via PR #301.                                                                                                                                                     | Chiuso come audit/read-only, non come apply o go-live reale.                                     |
| Task 1 | Completato | Modalità `new_products` / `existing_catalog`, normalizzazione e blocco import draft in `app/lib/syncbay-import-catalog-mode.ts` e `app/routes/app.import-preview.tsx`; PR #324/#325.                                                                                                                                                                       | Nessuna scrittura catalogo introdotta in questo task.                                            |
| Task 2 | Completato | Reason code stabili, segnali forti, handle/tag/metafield e blocco auto-link su varianti troncate in `app/lib/syncbay-product-matching.ts`; PR #324/#333.                                                                                                                                                                                                   | Titolo simile resta solo segnale da rivedere.                                                    |
| Task 3 | Completato | Report `applicabile`, `da_rivedere`, `bloccante`, `gia_collegato` e apply plan puro in `app/lib/syncbay-existing-catalog-takeover.ts`; PR #324.                                                                                                                                                                                                            | L'apply resta bloccato se il report contiene righe bloccanti.                                    |
| Task 4 | Completato | Loader Shopify paginato fino al limite MVP, normalizzazione prodotti e rilevazione varianti troncate in `app/services/shopify-existing-products.server.ts`; PR #330.                                                                                                                                                                                       | Il limite resta 2.000 prodotti per shop.                                                         |
| Task 5 | Completato | Preview Trading API completa solo su richiesta live, report UI e disabilitazione creazione prodotti in modalità existing in `app/services/ebay-trading-preview.server.ts`, `app/services/syncbay.server.ts` e `app/routes/app.import-preview.tsx`; PR #329/#330.                                                                                           | Il tab non chiama eBay/Shopify per migliaia di prodotti all'apertura.                            |
| Task 6 | Completato | Apply con conferma digitata obbligatoria `COLLEGA` verificata dall'action prima del claim, claim mapping/metafield prima del job, payload `reuseOnly` e runner allineato in `app/routes/app.import-preview.tsx`, `app/services/syncbay.server.ts`, `app/services/shopify-draft-import.server.ts` e `app/services/sync-job-runner.server.ts`; PR #331/#332. | Se il prodotto Shopify esistente non viene riusato, la riga fallisce invece di creare duplicati. |
| Task 7 | Completato | Policy campi generica con handle preservato, tag legacy su allowlist, immagini preservate quando Shopify ne ha già, e filtro media image-only in `app/lib/syncbay-existing-catalog-field-policy.ts` e import worker; PR #335.                                                                                                                              | Non cambia handle e non sostituisce immagini in massa.                                           |
| Task 8 | Completato | Privacy, termini minimi, mini kit clienti selezionati e release locale `0.50.0`; PR #340.                                                                                                                                                                                                                                                                  | Chiuso come readiness legale/prodotto, non come installazione o onboarding Numisleo.             |

**Verifiche fresche della revisione:** `npm run typecheck`, `npm run lint`,
`npm run build`, `npm run test:lib`, `npm run quality:react-doctor`,
`npm run smoke:ui`, `npm run release:dry-run`; PR #340 mergeata con CI, React
Doctor e Vercel production verdi.

## Baseline Reale

- `app/lib/syncbay-product-matching.ts` suggerisce già match conservativi con SKU, eBay ItemID su barcode e similarità titolo. Il risultato oggi è solo informativo e dice sempre "conferma manuale richiesta".
- `app/services/import-preview.server.ts` produce già preview normalizzata con descrizione pulita, categoria proposta, faccette, checklist qualità e `matchSuggestions`.
- `app/routes/app.import-preview.tsx` ha già lo stepper `Collegamento eBay -> Preparazione Shopify -> Anteprima catalogo -> Importazione -> Dopo l'import`.
- `app/services/shopify-draft-import.server.ts` crea o riusa prodotti SyncBay e aggiorna titolo, descrizione, prezzo, disponibilità, media, inventory, pubblicazioni, mapping e snapshot.
- `findMappedSyncBayDraftProduct` riusa un prodotto mappato solo se il prodotto Shopify ha già `metafield(namespace: "syncbay", key: "ebay_item_id")` uguale all'ItemID eBay.
- `ProductMapping` ha già vincolo unico `shopId + marketplaceId + ebayItemId`; non serve una nuova tabella per la 1.0.
- I report di categoria, faccette e descrizioni usano già pattern `report -> apply plan -> skipped`, da riusare per evitare una seconda grammatica operativa.

## Non Obiettivi 1.0

- App Store pubblico, billing e support policy pubblica.
- Migrazione hardcoded per Numisleo o per una specifica app precedente.
- Multi-marketplace, multi-location avanzato, varianti complesse.
- Collection manager: le regole collection esistenti restano intatte.
- Cambio massivo handle/URL: default `preserve`.
- Rollback self-service prodotto-per-prodotto: recovery manuale tramite snapshot, report e script interni.

## Target 1.0

- Marketplace: solo eBay.it.
- Cataloghi: numismatica e collezionismo con prodotti singoli, senza varianti
  complesse.
- Store: una sola location Shopify predefinita.
- Scala: tutti i listing attivi entro il limite MVP di 2.000 prodotti per shop.
- Distribuzione: custom app privata per uno o pochi clienti selezionati.

## Definition Of Done

- Il tab `Importazione` offre due modalità chiare: `Nuovi prodotti` e `Collega catalogo esistente`.
- In modalità catalogo esistente, il dry-run copre tutti i listing eBay attivi
  restituiti dalla Trading API entro il limite MVP di 2.000 prodotti, non una
  pagina campione.
- In modalità catalogo esistente, il dry-run completo parte solo dopo richiesta
  esplicita (`preview=live` o azione equivalente), così l'apertura del tab
  Importazione non chiama eBay/Shopify per migliaia di prodotti.
- Il dry-run produce righe `applicabile`, `da_rivedere`, `bloccante`,
  `gia_collegato`.
- Il collegamento automatico richiede almeno un segnale forte: SKU esatto, ItemID eBay su barcode/metafield/tag/handle o mapping SyncBay già coerente. Titolo simile da solo non collega.
- Prezzo, disponibilità, varianti complesse e mapping ambiguo sono bloccanti. Descrizioni, immagini, categorie, faccette, SEO e tag possono essere eccezioni da rivedere se non compromettono vendita e mapping.
- L'apply scrive solo righe applicabili, dopo conferma esplicita, e in modalità `reuseOnly`: se il prodotto Shopify esistente non viene riusato, SyncBay fallisce la riga invece di creare un duplicato.
- L'apply scrive prima metafield SyncBay e `ProductMapping`, poi riusa l'import worker ordinario per riallineare titolo, descrizione, prezzo, disponibilità, media, pubblicazioni e snapshot.
- Handle Shopify preservato di default. Se una futura riga richiede cambio handle, il report deve richiedere redirect esplicito; questa prima implementazione non cambia handle automaticamente.
- Tag legacy rimossi solo se riconosciuti come SyncBay legacy o inseriti esplicitamente nell'apply come allowlist esatta.
- Sync automatico eBay -> Shopify resta il flusso ordinario post-takeover; `orders/paid` -> eBay resta invariato.
- Nessun dato reale di cliente finisce in fixture, test, screenshot o repo.
- La release privata `1.0.0` è dichiarata prima dell'installazione su Numisleo:
  se un blocco critico emerge prima dell'installazione, si corregge e si
  rilascia la 1.0; se emerge durante l'onboarding Numisleo, si rilascia una
  patch `1.0.1+`.
- L'onboarding Numisleo è parte esplicita del piano post-1.0:
  installazione/autorizzazione privata, verifica runtime, configurazione,
  collegamento eBay, dry-run read-only, freeze, apply controllato e monitoraggio
  iniziale.
- Nessun apply Numisleo può partire solo perché l'app è installata: serve prima
  dry-run completo salvato fuori repo, classificazione eccezioni e conferma
  esplicita dell'operatore.
- Prima di ogni apply su store reale esiste un audit read-only completo dello
  store target: storefront, tema, Shopify Admin, app di sync precedente,
  catalogo eBay, dati prodotto, collezioni, URL, tag, metafield, location,
  pubblicazioni, ordini/webhook rilevanti e rischi operativi.

## File Map

- `app/lib/syncbay-import-catalog-mode.ts`: normalizza `catalogMode` per il tab Importazione.
- `app/lib/syncbay-product-matching.ts`: estende i segnali match con reason code stabili, handle, tag e metafield.
- `app/lib/syncbay-existing-catalog-takeover.ts`: costruisce report dry-run e apply plan pure.
- `app/lib/syncbay-existing-catalog-takeover.test.ts`: copre status, segnali forti, eccezioni e bloccanti.
- `app/services/shopify-existing-products.server.ts`: carica prodotti Shopify esistenti fino a 2.000 item, paginati.
- `app/services/import-preview.server.ts`: collega preview e report catalogo esistente.
- `app/services/ebay-trading-preview.server.ts`: riusa il piano Trading API completo per ottenere tutti gli ItemID attivi fino a 2.000.
- `app/services/syncbay.server.ts`: passa `catalogMode`, genera report, avvia job takeover.
- `app/services/shopify-draft-import.server.ts`: aggiunge opzione `reuseOnly` al percorso di import.
- `app/services/sync-job-runner.server.ts`: propaga `reuseOnly` dai job `IMPORT_CATALOG` di takeover.
- `app/routes/app.import-preview.tsx`: UI modalità, report, conferma apply.
- `app/routes/privacy.tsx`: aggiorna da privacy provvisoria pilota a informativa generale 1.0 privata.
- `app/routes/terms.tsx`: termini minimi SyncBay per clienti selezionati.
- `docs/guides/onboarding-e-import.md`: aggiunge il mini kit operativo per clienti selezionati nella guida esistente.
- `docs/decisions/0020-1-0-custom-privata-catalogo-esistente.md`: registra runbook e vincoli operativi del takeover 1.0.
- `README.md`: aggiorna stato progetto e prossimo passo operativo quando onboarding Numisleo avanza.
- `CHANGELOG.md`, `docs/INDEX.md`, `docs/ROADMAP.md`: riferimenti documentali.

## Task 0: Audit Completo Store Target

**Files:**

- No repo file for raw evidence: salvare output, screenshot e JSON in una
  cartella fuori repo o ignorata, per esempio
  `/Users/Matteo/SyncBay-audit/$SHOP_DOMAIN/$YYYYMMDD-HHMM/`.
- Modify after implementation only: `docs/decisions/0020-1-0-custom-privata-catalogo-esistente.md`
- Modify after implementation only: `docs/guides/onboarding-e-import.md`

- [x] **Step 1: creare cartella audit fuori repo**

  Run:

  ```bash
  test -n "$SYNCBAY_TAKEOVER_SHOP_DOMAIN"
  AUDIT_DIR="$HOME/SyncBay-audit/$SYNCBAY_TAKEOVER_SHOP_DOMAIN/$(date +%Y%m%d-%H%M)"
  mkdir -p "$AUDIT_DIR"/{shopify,storefront,ebay,legacy-sync,findings}
  printf '%s\n' "$AUDIT_DIR"
  ```

  Expected: stampa un path fuori da `/Users/Matteo/Progetti/SyncBay`.

- [x] **Step 2: audit storefront e frontend**

  Obiettivo: capire cosa il cliente vede oggi e cosa non deve rompersi durante
  takeover. Usare strumenti in questo ordine:

  1. HTTP/browser read-only per home, collection principali, ricerca, pagina
     prodotto, carrello e policy.
  2. Shopify CLI/theme read-only quando serve leggere tema live, app embed,
     template, metafield usati dal tema e Search & Discovery.
  3. Computer Use con Safari o Chrome solo per superfici non raggiungibili via
     CLI/plugin, salvando screenshot redatti fuori repo.

  Salvare nel report operativo:

  - tema live e versione;
  - template prodotto e collection usati;
  - app embed o script che toccano prodotto, prezzo, disponibilità o ricerca;
  - navigazione, menu, filtri, search overlay, quick view e carrello;
  - URL prodotto canonici, redirect esistenti, sitemap/robots, SEO title/meta;
  - collezioni automatiche visibili in navigazione;
  - problemi frontend bloccanti prima del takeover.

- [x] **Step 3: audit Shopify Admin e backend commerciale**

  Usare Shopify CLI/Admin GraphQL in sola lettura. Query minime:

  ```bash
  shopify store execute --store "$SYNCBAY_TAKEOVER_SHOP_DOMAIN" --version 2026-07 --json --query 'query SyncBayAuditLocations { locations(first: 20) { nodes { id name isActive fulfillsOnlineOrders } } }' --output-file "$AUDIT_DIR/shopify/locations.json"
  shopify store execute --store "$SYNCBAY_TAKEOVER_SHOP_DOMAIN" --version 2026-07 --json --query 'query SyncBayAuditProducts { products(first: 20, sortKey: UPDATED_AT, reverse: true) { nodes { id title handle status productType tags variants(first: 5) { nodes { id sku barcode inventoryQuantity } } metafields(first: 20, namespace: "syncbay") { nodes { key value } } } } }' --output-file "$AUDIT_DIR/shopify/products-sample.json"
  shopify store execute --store "$SYNCBAY_TAKEOVER_SHOP_DOMAIN" --version 2026-07 --json --query 'query SyncBayAuditCollections { collections(first: 100, sortKey: TITLE) { nodes { id title handle sortOrder productsCount { count } ruleSet { appliedDisjunctively rules { column relation condition } } sources { __typename id title description ... on CollectionConditionsSource { targetType shareable inclusion { matchType conditions { __typename id } } exclusion { matchType conditions { __typename id } } } ... on CollectionSubCollectionsSource { collections { id title handle } } } } } }' --output-file "$AUDIT_DIR/shopify/collections.json"
  ```

  Reportare:

  - location attiva da usare;
  - numero prodotti, varianti inattese, status, pubblicazioni/canali;
  - tag tecnici e tag commerciali da preservare;
  - metafield esistenti, inclusi segnali della vecchia app;
  - collezioni automatiche/manuali e regole che dipendono da titolo, tag,
    product type, disponibilità o vendor;
  - redirect esistenti e rischi SEO;
  - policy store rilevanti per privacy/termini.

- [x] **Step 4: audit app di sync precedente**

  Obiettivo: capire cosa scriveva la vecchia app e quali segnali lascia da
  esportare prima della disattivazione.

  Fonti:

  - Shopify Admin `Apps and sales channels` via browser quando non disponibile
    via API;
  - prodotti/metafield/tag/vendor/type creati o aggiornati dalla vecchia app;
  - eventuali app embed, webhook, scheduled sync, mapping export, log e
    impostazioni disponibili nell'app;
  - confronto tra ultimi aggiornamenti Shopify e listing eBay.

  Output:

  - nome app, stato installazione e ambito apparente;
  - campi scritti dalla vecchia app;
  - segnali utili al matching SyncBay;
  - segnali da esportare prima della disattivazione;
  - rischi se la vecchia app resta attiva durante apply;
  - momento consigliato di disattivazione.

- [x] **Step 5: audit eBay e catalogo sorgente**

  Usare letture eBay già previste da SyncBay/CLI/script, senza scritture.

  Reportare:

  - numero listing attivi letto da Trading API;
  - listing senza SKU, SKU duplicati o SKU generati;
  - listing con prezzo/disponibilità mancanti o non leggibili;
  - listing con varianti;
  - descrizioni con template pesante;
  - immagini mancanti o incoerenti;
  - categorie e item specifics utili a product type/faccette;
  - listing chiusi/inattivi da mantenere Shopify esauriti secondo ADR 0011.

- [x] **Step 6: produrre report operativo redatto**

  Creare fuori repo un file `findings/audit-summary.md` con:

  ```markdown
  # Store Takeover Audit

  ## Scope

  - Shop:
  - Date:
  - Auditor:
  - Read-only sources:

  ## Executive Summary

  - Go / No-go:
  - Blockers:
  - Review exceptions:

  ## Storefront

  ## Shopify Admin

  ## Legacy Sync App

  ## eBay Catalog

  ## Mapping Signals

  ## Field Policies

  ## Freeze Plan

  ## Apply Preconditions

  ## Manual Verification Checklist
  ```

  Non committare screenshot, JSON grezzi, dati prodotti reali, ordini o dati
  cliente. Nel repo può entrare solo una sintesi generica se cambia una regola
  SyncBay riusabile.

- [x] **Step 7: bloccare apply se l'audit è incompleto**

  Prima di Task 6, verificare:

  - audit storefront completato;
  - audit Shopify Admin completato;
  - audit vecchia app completato o limite documentato;
  - audit eBay completo fino al limite MVP;
  - segnali legacy esportati o dichiarati assenti;
  - freeze plan approvato;
  - elenco eccezioni `da_rivedere` accettato dal maintainer/operatore.

## Task 1: Modalità Catalogo Nel Tab Importazione

**Files:**

- Create: `app/lib/syncbay-import-catalog-mode.ts`
- Test: `app/lib/syncbay-import-catalog-mode.test.ts`
- Modify: `app/routes/app.import-preview.tsx`
- Modify: `app/services/syncbay.server.ts`

- [x] **Step 1: scrivere il test del normalizzatore**

  ```ts
  import assert from "node:assert/strict";
  import test from "node:test";
  import {
    getImportCatalogModeLabel,
    normalizeImportCatalogMode,
  } from "./syncbay-import-catalog-mode.ts";

  test("defaults to new product import mode", () => {
    assert.equal(normalizeImportCatalogMode(null), "new_products");
    assert.equal(normalizeImportCatalogMode(""), "new_products");
    assert.equal(normalizeImportCatalogMode("legacy"), "new_products");
  });

  test("accepts existing catalog takeover mode", () => {
    assert.equal(normalizeImportCatalogMode("existing"), "existing_catalog");
  });

  test("formats labels in Italian", () => {
    assert.equal(getImportCatalogModeLabel("new_products"), "Nuovi prodotti");
    assert.equal(
      getImportCatalogModeLabel("existing_catalog"),
      "Collega catalogo esistente",
    );
  });
  ```

- [x] **Step 2: verificare il fallimento**

  Run:

  ```bash
  node --test --experimental-strip-types app/lib/syncbay-import-catalog-mode.test.ts
  ```

  Expected: FAIL perché `syncbay-import-catalog-mode.ts` non esiste.

- [x] **Step 3: implementare il normalizzatore**

  ```ts
  export type ImportCatalogMode = "existing_catalog" | "new_products";

  export function normalizeImportCatalogMode(
    value: FormDataEntryValue | string | null | undefined,
  ): ImportCatalogMode {
    return value === "existing" || value === "existing_catalog"
      ? "existing_catalog"
      : "new_products";
  }

  export function getImportCatalogModeParam(mode: ImportCatalogMode) {
    return mode === "existing_catalog" ? "existing" : "new";
  }

  export function getImportCatalogModeLabel(mode: ImportCatalogMode) {
    return mode === "existing_catalog"
      ? "Collega catalogo esistente"
      : "Nuovi prodotti";
  }
  ```

- [x] **Step 4: rendere `getImportWizardState` parametrico**

  In `app/services/syncbay.server.ts`:

  ```ts
  import type { ImportCatalogMode } from "../lib/syncbay-import-catalog-mode";

  export async function getImportWizardState(
    session: ShopifySessionLike,
    admin?: ShopifyAdminGraphqlClient,
    trace?: SyncBayLoaderPerformanceTrace,
    options: {
      catalogMode?: ImportCatalogMode;
      previewLoadMode?: ImportPreviewLoadMode;
    } = {},
  ) {
    const catalogMode = options.catalogMode ?? "new_products";
  }
  ```

  Nel return finale già presente di `getImportWizardState`, aggiungere la
  proprietà `catalogMode` allo stesso livello di `draftImport`, `previewResult`
  e `previewSource`, senza rinominare gli altri campi.

- [x] **Step 5: leggere `catalogMode` dal loader**

  In `app/routes/app.import-preview.tsx`:

  ```ts
  import {
    getImportCatalogModeLabel,
    getImportCatalogModeParam,
    normalizeImportCatalogMode,
  } from "../lib/syncbay-import-catalog-mode";

  const catalogMode = normalizeImportCatalogMode(
    url.searchParams.get("catalogMode"),
  );

  getImportWizardState(session, admin, trace, {
    catalogMode,
    previewLoadMode,
  });
  ```

- [x] **Step 6: aggiungere il selettore UI senza cambiare comportamento**

  Usare `s-clickable-chip` o `s-button` con link querystring:

  ```tsx
  <s-stack direction="inline" gap="small-200">
    {(["new_products", "existing_catalog"] as const).map((mode) => {
      const params = new URLSearchParams(searchParams);
      params.set("catalogMode", getImportCatalogModeParam(mode));
      return (
        <s-button
          key={mode}
          href={`/app/import-preview?${params.toString()}`}
          variant={wizard.catalogMode === mode ? "primary" : "secondary"}
        >
          {getImportCatalogModeLabel(mode)}
        </s-button>
      );
    })}
  </s-stack>
  ```

- [x] **Step 7: verifiche e commit**

  Run:

  ```bash
  node --test --experimental-strip-types app/lib/syncbay-import-catalog-mode.test.ts
  npm run typecheck
  npm run lint
  git diff --check
  ```

  Commit:

  ```bash
  git add app/lib/syncbay-import-catalog-mode.ts app/lib/syncbay-import-catalog-mode.test.ts app/routes/app.import-preview.tsx app/services/syncbay.server.ts
  git commit -m "feat: add import catalog mode"
  ```

## Task 2: Matching Con Reason Code E Segnali Forti

**Files:**

- Modify: `app/lib/syncbay-product-matching.ts`
- Modify: `app/lib/syncbay-product-matching.test.ts`

- [x] **Step 1: aggiungere test per metafield, handle e titolo non auto-linkabile**

  ```ts
  test("uses syncbay metafield item id as a strong match signal", () => {
    const suggestions = buildExistingProductMatchSuggestions({
      ebay: { itemId: "156986744184", sku: null, title: "Moneta argento" },
      shopifyProducts: [
        {
          metafields: [
            {
              key: "ebay_item_id",
              namespace: "syncbay",
              value: "156986744184",
            },
          ],
          productGid: "gid://shopify/Product/10",
          title: "Moneta argento",
          variantGid: "gid://shopify/ProductVariant/10",
        },
      ],
    });

    assert.equal(suggestions[0]?.confidence, "high");
    assert.equal(suggestions[0]?.autoLinkable, true);
    assert.deepEqual(suggestions[0]?.reasonCodes, [
      "syncbay_metafield_item_id",
      "title_very_similar",
    ]);
  });

  test("does not mark title-only matches as auto linkable", () => {
    const suggestions = buildExistingProductMatchSuggestions({
      ebay: { itemId: "1", sku: null, title: "Moneta argento Regno Italia" },
      shopifyProducts: [
        {
          productGid: "gid://shopify/Product/11",
          title: "Moneta argento Regno Italia",
          variantGid: "gid://shopify/ProductVariant/11",
        },
      ],
    });

    assert.equal(suggestions[0]?.confidence, "medium");
    assert.equal(suggestions[0]?.autoLinkable, false);
    assert.deepEqual(suggestions[0]?.reasonCodes, ["title_very_similar"]);
  });

  test("uses item id embedded in handle as a strong conservative signal", () => {
    const suggestions = buildExistingProductMatchSuggestions({
      ebay: { itemId: "987654321", sku: null, title: "Lire argento" },
      shopifyProducts: [
        {
          handle: "lire-argento-987654321",
          productGid: "gid://shopify/Product/12",
          title: "Lire argento",
          variantGid: "gid://shopify/ProductVariant/12",
        },
      ],
    });

    assert.equal(suggestions[0]?.confidence, "high");
    assert.equal(suggestions[0]?.autoLinkable, true);
    assert.ok(suggestions[0]?.reasonCodes.includes("handle_item_id"));
  });
  ```

- [x] **Step 2: estendere tipi e scoring**

  In `app/lib/syncbay-product-matching.ts`:

  ```ts
  export type ExistingProductMatchReasonCode =
    | "barcode_item_id"
    | "handle_item_id"
    | "sku_exact"
    | "syncbay_metafield_item_id"
    | "tag_item_id"
    | "title_similar"
    | "title_very_similar";

  export interface ShopifyMatchMetafieldCandidate {
    key: string;
    namespace: string;
    value?: string | null;
  }

  export interface ShopifyMatchCandidate {
    barcode?: string | null;
    handle?: string | null;
    metafields?: ShopifyMatchMetafieldCandidate[];
    productGid: string;
    sku?: string | null;
    tags?: string[];
    title?: string | null;
    variantGid?: string | null;
  }

  export interface ExistingProductMatchSuggestion {
    autoLinkable: boolean;
    confidence: MatchConfidence;
    productGid: string;
    reasonCodes: ExistingProductMatchReasonCode[];
    reasons: string[];
    score: number;
    variantGid: string | null;
  }
  ```

  Aggiungere punteggi:

  ```ts
  if (sameToken(input.ebay.itemId, getSyncBayItemId(product.metafields))) {
    score += 98;
    reasonCodes.push("syncbay_metafield_item_id");
    reasons.push("ItemID eBay trovato nei metafield SyncBay");
  }
  if (sameToken(input.ebay.sku, product.sku)) {
    score += 100;
    reasonCodes.push("sku_exact");
    reasons.push("SKU identico");
  }
  if (sameToken(input.ebay.itemId, product.barcode)) {
    score += 95;
    reasonCodes.push("barcode_item_id");
    reasons.push("ItemID eBay trovato su barcode");
  }
  if (containsToken(product.handle, input.ebay.itemId)) {
    score += 92;
    reasonCodes.push("handle_item_id");
    reasons.push("ItemID eBay trovato nell'handle Shopify");
  }
  if (
    (product.tags ?? []).some((tag) => containsToken(tag, input.ebay.itemId))
  ) {
    score += 80;
    reasonCodes.push("tag_item_id");
    reasons.push("ItemID eBay trovato nei tag Shopify");
  }
  ```

  Calcolo auto-link:

  ```ts
  const STRONG_AUTO_LINK_CODES = new Set<ExistingProductMatchReasonCode>([
    "barcode_item_id",
    "handle_item_id",
    "sku_exact",
    "syncbay_metafield_item_id",
    "tag_item_id",
  ]);

  function isAutoLinkable(
    confidence: MatchConfidence,
    reasonCodes: ExistingProductMatchReasonCode[],
  ) {
    return (
      confidence === "high" &&
      reasonCodes.some((code) => STRONG_AUTO_LINK_CODES.has(code))
    );
  }
  ```

- [x] **Step 3: mantenere compatibilità UI**

  Non rimuovere `reasons`. Le schermate esistenti possono continuare a usare copy italiano, mentre il report 1.0 userà `reasonCodes`.

- [x] **Step 4: verifiche e commit**

  Run:

  ```bash
  node --test --experimental-strip-types app/lib/syncbay-product-matching.test.ts
  npm run test:lib
  npm run typecheck
  git diff --check
  ```

  Commit:

  ```bash
  git add app/lib/syncbay-product-matching.ts app/lib/syncbay-product-matching.test.ts
  git commit -m "feat: strengthen existing product matching"
  ```

## Task 3: Report Dry-Run Catalogo Esistente

**Files:**

- Create: `app/lib/syncbay-existing-catalog-takeover.ts`
- Test: `app/lib/syncbay-existing-catalog-takeover.test.ts`
- Modify: `app/services/import-preview.server.ts`

- [x] **Step 1: scrivere test per applicabile, da rivedere e bloccante**

  ```ts
  import assert from "node:assert/strict";
  import test from "node:test";
  import { buildExistingCatalogTakeoverReport } from "./syncbay-existing-catalog-takeover.ts";

  test("marks one auto-linkable valid row as applicable", () => {
    const report = buildExistingCatalogTakeoverReport({
      items: [
        makePreviewItem({
          itemId: "1001",
          matchSuggestions: [
            {
              autoLinkable: true,
              confidence: "high",
              productGid: "gid://shopify/Product/1",
              reasonCodes: ["sku_exact"],
              reasons: ["SKU identico"],
              score: 100,
              variantGid: "gid://shopify/ProductVariant/1",
            },
          ],
          priceAmount: 12,
          quantity: 1,
        }),
      ],
      shopDomain: "example.myshopify.com",
    });

    assert.equal(report.summary.applicable, 1);
    assert.equal(report.rows[0]?.status, "applicabile");
    assert.deepEqual(report.rows[0]?.plannedOperations, [
      "claim_mapping",
      "sync_title",
      "sync_description",
      "sync_price",
      "sync_quantity",
      "sync_category",
      "sync_facets",
      "sync_seo",
      "add_syncbay_tag",
      "preserve_handle",
    ]);
  });

  test("marks title-only matches as review", () => {
    const report = buildExistingCatalogTakeoverReport({
      items: [
        makePreviewItem({
          itemId: "1002",
          matchSuggestions: [
            {
              autoLinkable: false,
              confidence: "medium",
              productGid: "gid://shopify/Product/2",
              reasonCodes: ["title_very_similar"],
              reasons: ["Titolo molto simile"],
              score: 40,
              variantGid: "gid://shopify/ProductVariant/2",
            },
          ],
          priceAmount: 15,
          quantity: 1,
        }),
      ],
      shopDomain: "example.myshopify.com",
    });

    assert.equal(report.summary.review, 1);
    assert.equal(report.rows[0]?.status, "da_rivedere");
    assert.ok(report.rows[0]?.reasons.includes("match_non_automatico"));
  });

  test("blocks invalid price and complex variants", () => {
    const report = buildExistingCatalogTakeoverReport({
      items: [
        makePreviewItem({
          itemId: "1003",
          issueCodes: ["invalid_price", "complex_variants"],
          matchSuggestions: [],
          priceAmount: null,
          quantity: 1,
        }),
      ],
      shopDomain: "example.myshopify.com",
    });

    assert.equal(report.summary.blocked, 1);
    assert.equal(report.rows[0]?.status, "bloccante");
    assert.deepEqual(report.rows[0]?.reasons, [
      "prezzo_ebay_non_valido",
      "varianti_non_supportate",
      "match_shopify_mancante",
    ]);
  });
  ```

  Nel test creare un helper locale `makePreviewItem` che costruisce solo i campi usati dal report; non usare dati reali.

- [x] **Step 2: implementare tipi e regole pure**

  ```ts
  import type { ExistingProductMatchSuggestion } from "./syncbay-product-matching";
  import type { ImportPreviewItem } from "../services/import-preview.server";

  export type ExistingCatalogTakeoverStatus =
    "applicabile" | "bloccante" | "da_rivedere" | "gia_collegato";

  export type ExistingCatalogTakeoverReason =
    | "categoria_incerta"
    | "disponibilita_ebay_non_valida"
    | "immagini_mancanti"
    | "match_ambiguo"
    | "match_non_automatico"
    | "match_shopify_mancante"
    | "prezzo_ebay_non_valido"
    | "varianti_non_supportate";

  export type ExistingCatalogPlannedOperation =
    | "add_syncbay_tag"
    | "claim_mapping"
    | "preserve_handle"
    | "sync_category"
    | "sync_description"
    | "sync_facets"
    | "sync_price"
    | "sync_quantity"
    | "sync_seo"
    | "sync_title";
  ```

  Regole:

  ```ts
  function getBlockingReasons(item: ImportPreviewItem) {
    const issueCodes = new Set(item.issues.map((issue) => issue.code));
    return [
      issueCodes.has("invalid_price") ? "prezzo_ebay_non_valido" : null,
      issueCodes.has("invalid_quantity")
        ? "disponibilita_ebay_non_valida"
        : null,
      issueCodes.has("complex_variants") ? "varianti_non_supportate" : null,
    ].filter((reason): reason is ExistingCatalogTakeoverReason =>
      Boolean(reason),
    );
  }

  function getBestAutoLinkableMatch(matches: ExistingProductMatchSuggestion[]) {
    const autoMatches = matches.filter((match) => match.autoLinkable);
    const productIds = new Set(autoMatches.map((match) => match.productGid));
    if (productIds.size !== 1) return null;
    return autoMatches[0] ?? null;
  }
  ```

- [x] **Step 3: aggiungere `existingCatalogTakeover` alla preview**

  In `ImportPreviewResult` aggiungere campo opzionale:

  ```ts
  existingCatalogTakeover?: ExistingCatalogTakeoverReport;
  ```

  In `addExistingProductMatchSuggestions`, non costruire ancora il report: limitarsi a mantenere `matchSuggestions`. Il report verrà creato in `getImportWizardState`, perché lì è noto `catalogMode`.

- [x] **Step 4: verifiche e commit**

  Run:

  ```bash
  node --test --experimental-strip-types app/lib/syncbay-existing-catalog-takeover.test.ts
  npm run test:lib
  npm run typecheck
  git diff --check
  ```

  Commit:

  ```bash
  git add app/lib/syncbay-existing-catalog-takeover.ts app/lib/syncbay-existing-catalog-takeover.test.ts app/services/import-preview.server.ts
  git commit -m "feat: add existing catalog takeover report"
  ```

## Task 4: Lettura Shopify Esistente Fino A 2.000 Prodotti

**Files:**

- Create: `app/services/shopify-existing-products.server.ts`
- Test: `app/lib/syncbay-product-matching.test.ts`
- Modify: `app/services/syncbay.server.ts`

- [x] **Step 1: estrarre il loader da `syncbay.server.ts`**

  Creare `app/services/shopify-existing-products.server.ts`:

  ```ts
  import type { ShopifyMatchCandidate } from "../lib/syncbay-product-matching";

  interface ShopifyAdminGraphqlClient {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  }

  const DEFAULT_EXISTING_PRODUCT_LIMIT = 2000;
  const SHOPIFY_PRODUCTS_PAGE_SIZE = 250;

  export async function loadExistingShopifyProductsForMatching(
    admin: ShopifyAdminGraphqlClient,
    options: { limit?: number } = {},
  ): Promise<ShopifyMatchCandidate[]> {
    const limit = Math.min(
      Math.max(options.limit ?? DEFAULT_EXISTING_PRODUCT_LIMIT, 1),
      DEFAULT_EXISTING_PRODUCT_LIMIT,
    );
    const products: ShopifyMatchCandidate[] = [];
    let cursor: string | null = null;

    while (products.length < limit) {
      const page = await fetchExistingProductsPage(admin, {
        cursor,
        first: Math.min(SHOPIFY_PRODUCTS_PAGE_SIZE, limit - products.length),
      });
      products.push(...page.products);
      if (!page.hasNextPage || !page.endCursor) break;
      cursor = page.endCursor;
    }

    return products.slice(0, limit);
  }
  ```

- [x] **Step 2: usare query paginata con campi utili al takeover**

  ```ts
  const EXISTING_PRODUCTS_QUERY = `#graphql
    query SyncBayExistingProductsForMatching($first: Int!, $after: String) {
      products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
        nodes {
          id
          handle
          productType
          status
          tags
          title
          metafields(first: 20, namespace: "syncbay") {
            nodes {
              key
              namespace
              value
            }
          }
          seo {
            description
            title
          }
          variants(first: 100) {
            nodes {
              barcode
              id
              sku
            }
          }
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }`;
  ```

  `fetchExistingProductsPage` deve tornare `[]` su risposta GraphQL non ok o con errori, senza stampare payload sensibili.

- [x] **Step 3: normalizzare i prodotti**

  Ogni variante produce un `ShopifyMatchCandidate`; prodotti senza varianti producono comunque una riga prodotto con `variantGid: null`.

  ```ts
  interface ExistingProductNode {
    handle?: string | null;
    id?: string | null;
    metafields?: {
      nodes?: Array<{
        key: string;
        namespace: string;
        value?: string | null;
      }>;
    } | null;
    tags?: string[] | null;
    title?: string | null;
    variants?: {
      nodes?: Array<{
        barcode?: string | null;
        id: string;
        sku?: string | null;
      }>;
    } | null;
  }

  function toMatchCandidates(
    product: ExistingProductNode,
  ): ShopifyMatchCandidate[] {
    const variants = product.variants?.nodes?.length
      ? product.variants.nodes
      : [null];

    return variants.flatMap((variant) =>
      product.id
        ? [
            {
              barcode: normalizeNullableString(variant?.barcode),
              handle: normalizeNullableString(product.handle),
              metafields: product.metafields?.nodes ?? [],
              productGid: product.id,
              sku: normalizeNullableString(variant?.sku),
              tags: product.tags ?? [],
              title: normalizeNullableString(product.title),
              variantGid: variant?.id ?? null,
            },
          ]
        : [],
    );
  }
  ```

- [x] **Step 4: sostituire la funzione privata**

  In `app/services/syncbay.server.ts`, rimuovere la funzione privata `loadExistingShopifyProductsForMatching` e importare quella nuova.

- [x] **Step 5: verifiche e commit**

  Run:

  ```bash
  npm run typecheck
  npm run lint
  npm run test:lib
  git diff --check
  ```

  Commit:

  ```bash
  git add app/services/shopify-existing-products.server.ts app/services/syncbay.server.ts app/lib/syncbay-product-matching.test.ts
  git commit -m "feat: load existing Shopify catalog for takeover"
  ```

## Task 5: Collegare Report Al Loader E Alla UI

**Files:**

- Modify: `app/services/ebay-trading-preview.server.ts`
- Modify: `app/services/syncbay.server.ts`
- Modify: `app/routes/app.import-preview.tsx`
- Modify: `app/lib/syncbay-existing-catalog-takeover.ts`

- [x] **Step 1: esporre il recupero completo da Trading API**

  In `app/services/ebay-trading-preview.server.ts`, aggiungere un helper
  esportato che usa funzioni già presenti (`getEbayTradingCatalogImportPlan` e
  `getEbayTradingCandidatesByItemIds`) e costruisce una `ImportPreviewResult`
  completa.

  ```ts
  import type { DescriptionRuleMode } from "../lib/syncbay-description-rules";
  import { buildImportPreview } from "./import-preview.server";

  export async function getEbayTradingCatalogImportPreview(input: {
    accessToken: string;
    connection: EbayConnection;
    descriptionRuleMode?: DescriptionRuleMode;
    maxProducts: number;
  }) {
    const plan = await getEbayTradingCatalogImportPlan({
      accessToken: input.accessToken,
      connection: input.connection,
      maxProducts: input.maxProducts,
    });
    const candidates = await getEbayTradingCandidatesByItemIds({
      accessToken: input.accessToken,
      connection: input.connection,
      itemIds: plan.itemIds,
    });

    return {
      previewResult: buildImportPreview(candidates, "live", {
        descriptionRuleMode: input.descriptionRuleMode,
      }),
      readCount: plan.readCount,
      totalAvailable: plan.totalAvailable,
      totalPlanned: plan.itemIds.length,
      truncatedAtMaxProducts:
        plan.totalAvailable !== null
          ? plan.totalAvailable > plan.itemIds.length
          : plan.itemIds.length >= input.maxProducts,
    };
  }
  ```

- [x] **Step 2: costruire il report solo dopo richiesta live**

  In `app/services/syncbay.server.ts`, importare
  `getEbayTradingCatalogImportPreview` e creare un wrapper locale che recupera
  il token eBay:

  ```ts
  async function getExistingCatalogTakeoverPreview(input: {
    connection: EbayConnection;
    descriptionRuleMode: DescriptionRuleMode;
    maxProducts: number;
  }) {
    const { accessToken } = await getUsableEbayAccessToken(input.connection);

    return getEbayTradingCatalogImportPreview({
      accessToken,
      connection: input.connection,
      descriptionRuleMode: input.descriptionRuleMode,
      maxProducts: input.maxProducts,
    });
  }
  ```

  Poi in `getImportWizardState`:

  ```ts
  const takeoverPreviewResult =
    catalogMode === "existing_catalog" &&
    previewLoadMode === "live" &&
    ebayConnection
      ? (
          await getExistingCatalogTakeoverPreview({
            connection: ebayConnection,
            descriptionRuleMode: descriptionRule.mode,
            maxProducts: 2000,
          })
        ).previewResult
      : previewResult;

  const existingCatalogTakeover =
    catalogMode === "existing_catalog" && previewLoadMode === "live"
      ? buildExistingCatalogTakeoverReport({
          items: takeoverPreviewResult.items,
          shopDomain: shop.shopDomain,
        })
      : null;
  ```

  Nel return finale esistente aggiungere `catalogMode` e
  `existingCatalogTakeover` accanto a `draftImport`, `previewResult` e
  `previewSource`. In modalità `existing_catalog`, `previewResult` deve usare
  `takeoverPreviewResult` solo quando `previewLoadMode === "live"`, così
  filtri, paginazione e report leggono tutti i listing attivi entro il limite
  MVP solo dopo azione esplicita.

  `getExistingCatalogTakeoverPreview` deve chiamare
  `getEbayTradingCatalogImportPreview`, che usa `getEbayTradingCatalogImportPlan`
  per ottenere tutti gli ItemID attivi e poi recupera i dettagli con
  `getEbayTradingCandidatesByItemIds`; non deve fermarsi alla prima pagina
  Inventory API.

- [x] **Step 3: disabilitare l'azione di creazione prodotti in modalità existing**

  In `DraftImportSection`, se `wizard.catalogMode === "existing_catalog"`:

  - non mostrare copy "creare prodotti";
  - mostrare "Applica takeover righe sicure";
  - disabilitare se `existingCatalogTakeover.summary.applicable === 0`;
  - disabilitare se `existingCatalogTakeover.summary.blocked > 0`.

- [x] **Step 4: aggiungere pannello report**

  Creare `ExistingCatalogTakeoverSection` in `app/routes/app.import-preview.tsx`:

  ```tsx
  function ExistingCatalogTakeoverSection({
    report,
  }: {
    report: NonNullable<WizardState["existingCatalogTakeover"]>;
  }) {
    return (
      <s-section heading="Collega catalogo esistente">
        <s-grid gridTemplateColumns="repeat(4, minmax(0, 1fr))" gap="base">
          <MetricTile
            icon="check-circle"
            label="Applicabili"
            value={String(report.summary.applicable)}
          />
          <MetricTile
            icon="alert-triangle"
            label="Da rivedere"
            value={String(report.summary.review)}
          />
          <MetricTile
            icon="alert-circle"
            label="Bloccanti"
            value={String(report.summary.blocked)}
          />
          <MetricTile
            icon="link"
            label="Già collegati"
            value={String(report.summary.alreadyLinked)}
          />
        </s-grid>
        <s-text color="subdued">
          SyncBay collega solo righe con segnali forti. I casi incerti restano
          da rivedere e non vengono scritti.
        </s-text>
      </s-section>
    );
  }
  ```

- [x] **Step 5: mostrare status riga nei dettagli preview**

  In `MatchSuggestionDetails`, se esiste `existingCatalogTakeover`, cercare la riga per `item.itemId` e mostrare:

  ```tsx
  <s-text>
    Stato takeover: {formatExistingCatalogTakeoverStatus(row.status)}.
    Operazioni: {row.plannedOperations.map(formatOperation).join(", ")}.
  </s-text>
  ```

- [x] **Step 6: verifiche e commit**

  Run:

  ```bash
  npm run typecheck
  npm run lint
  npm run build
  git diff --check
  ```

  Commit:

  ```bash
  git add app/services/ebay-trading-preview.server.ts app/services/syncbay.server.ts app/routes/app.import-preview.tsx app/lib/syncbay-existing-catalog-takeover.ts
  git commit -m "feat: show existing catalog takeover dry run"
  ```

## Task 6: Apply Takeover In Modalità Reuse-Only

**Files:**

- Modify: `app/services/shopify-draft-import.server.ts`
- Modify: `app/services/syncbay.server.ts`
- Modify: `app/services/sync-job-runner.server.ts`
- Modify: `app/routes/app.import-preview.tsx`
- Test: `app/lib/syncbay-existing-catalog-takeover.test.ts`

- [x] **Step 1: aggiungere `reuseOnly` all'import draft**

  In `createShopifyDraftProductsIfEnabled`:

  ```ts
  export async function createShopifyDraftProductsIfEnabled(input: {
    admin: ShopifyAdminGraphqlClient;
    catalogImportRunId?: string | null;
    defaultLocationGid?: string | null;
    hasDefaultLocation: boolean;
    importProductStatusOverride?: ImportProductStatus;
    previewResult: ImportPreviewResult;
    reuseOnly?: boolean;
    shopDomain: string;
  }) {
    const reuseOnly = input.reuseOnly === true;
  }
  ```

  Usare la costante `reuseOnly` quando viene chiamata
  `createShopifyDraftProductSafely`, passandola nel contesto insieme a
  `defaultLocationGid`, `jobId`, `publicationOptions` e `shopId`.

  Propagare a `createShopifyDraftProductSafely` e `createShopifyDraftProduct`.

- [x] **Step 2: impedire duplicati se `reuseOnly` è attivo**

  In `createShopifyDraftProduct`:

  ```ts
  if (!existingProduct && options.reuseOnly) {
    return {
      errorMessage:
        "Takeover catalogo esistente bloccato: prodotto Shopify esistente non riusato, nessun duplicato creato.",
      status: "failed",
    };
  }
  ```

- [x] **Step 3: creare claim mapping + metafield prima del job**

  In `app/services/syncbay.server.ts`, aggiungere `startExistingCatalogTakeoverJobs(session, admin, input)`.

  Regole:

  - Ricostruire il dry-run completo con `catalogMode: "existing_catalog"` prima
    di scrivere, usando tutti gli ItemID attivi dal piano Trading API fino a
    2.000.
  - Accettare solo righe `applicabile`.
  - Se `blocked > 0`, rispondere `blocked` con messaggio italiano.
  - Richiedere `confirmation === "COLLEGA"`.
  - Prima di scrivere claim o mapping, leggere il prodotto Shopify scelto e
    registrare snapshot/audit pre-claim con `source: ProductSnapshotSource.SHOPIFY`,
    così la recovery manuale ha il valore precedente.
  - Per ogni riga applicabile, scrivere `syncbay.ebay_item_id` e gli altri metafield base con `metafieldsSet`.
  - Upsert `ProductMapping` con `status: ACTIVE`, `shopifyProductGid`, `shopifyVariantGid`, `sku`.
  - Creare job `IMPORT_CATALOG` con payload:

  ```ts
  {
    catalogImportRunId,
    ebayItemIds,
    importProductStatus,
    reuseOnly: true,
    source: "existing_catalog_takeover",
  }
  ```

- [x] **Step 4: propagare `reuseOnly` nel runner**

  In `app/services/sync-job-runner.server.ts`, aggiungere un helper accanto a
  `getStringFromPayload`:

  ```ts
  function getBooleanFromPayload(
    payload: Prisma.JsonValue | null,
    key: string,
  ) {
    const value = getJsonObject(payload)?.[key];
    return typeof value === "boolean" ? value : false;
  }
  ```

  In `runImportCatalogJob`:

  ```ts
  const result = await createShopifyDraftProductsIfEnabled({
    admin,
    catalogImportRunId: getCatalogImportRunId(job.payload),
    defaultLocationGid: job.shop.defaultLocationGid,
    hasDefaultLocation: Boolean(job.shop.defaultLocationGid),
    importProductStatusOverride: getImportProductStatus(job.payload),
    previewResult: filteredPreviewResult,
    reuseOnly: getBooleanFromPayload(job.payload, "reuseOnly"),
    shopDomain: job.shop.shopDomain,
  });
  ```

- [x] **Step 5: aggiungere action UI**

  In `app/routes/app.import-preview.tsx`:

  ```tsx
  <Form method="post">
    <input type="hidden" name="intent" value="applyExistingCatalogTakeover" />
    <input type="hidden" name="confirmation" value="COLLEGA" />
    <s-button
      disabled={
        isSaving ||
        report.summary.applicable === 0 ||
        report.summary.blocked > 0
      }
      loading={isApplyingTakeover}
      type="submit"
      variant="primary"
    >
      Applica takeover righe sicure
    </s-button>
  </Form>
  ```

  Nell'action:

  ```ts
  if (intent === "applyExistingCatalogTakeover") {
    const result = await startExistingCatalogTakeoverJobs(session, admin, {
      confirmation: String(formData.get("confirmation") ?? ""),
    });

    return Response.json({
      intent,
      jobCount: result.status === "queued" ? result.batchCount : undefined,
      message:
        result.status === "queued"
          ? `Takeover pianificato per ${result.plannedListingCount} prodotti.`
          : result.blockers.join(", "),
      status: result.status,
    });
  }
  ```

- [x] **Step 6: verifiche e commit**

  Run:

  ```bash
  npm run test:lib
  npm run typecheck
  npm run lint
  npm run build
  npm run prisma:validate
  git diff --check
  ```

  Commit:

  ```bash
  git add app/services/shopify-draft-import.server.ts app/services/syncbay.server.ts app/services/sync-job-runner.server.ts app/routes/app.import-preview.tsx app/lib/syncbay-existing-catalog-takeover.test.ts
  git commit -m "feat: apply existing catalog takeover safely"
  ```

## Task 7: Policy Tag, URL, Immagini E Collezioni

**Files:**

- Create: `app/lib/syncbay-existing-catalog-field-policy.ts`
- Test: `app/lib/syncbay-existing-catalog-field-policy.test.ts`
- Modify: `app/lib/syncbay-existing-catalog-takeover.ts`
- Modify: `app/routes/app.import-preview.tsx`

- [x] **Step 1: testare policy URL e tag**

  ```ts
  import assert from "node:assert/strict";
  import test from "node:test";
  import { buildExistingCatalogFieldPolicy } from "./syncbay-existing-catalog-field-policy.ts";

  test("preserves product handles by default", () => {
    const policy = buildExistingCatalogFieldPolicy({
      currentHandle: "moneta-argento-1901",
      legacyTagsToRemove: [],
      shopifyImageCount: 2,
      syncbayLegacyTags: [],
    });

    assert.equal(policy.handle.operation, "preserve");
    assert.equal(policy.handle.redirectRequired, false);
  });

  test("removes only explicit legacy tags and adds SyncBay source tag", () => {
    const policy = buildExistingCatalogFieldPolicy({
      currentTags: ["Vecchia app", "Monete rare"],
      legacyTagsToRemove: ["Vecchia app"],
      shopifyImageCount: 1,
      syncbayLegacyTags: ["Import preview"],
    });

    assert.deepEqual(policy.tags.remove, ["Vecchia app"]);
    assert.deepEqual(policy.tags.add, ["Negozio eBay"]);
    assert.deepEqual(policy.tags.preserve, ["Monete rare"]);
  });
  ```

- [x] **Step 2: implementare helper policy**

  ```ts
  export function buildExistingCatalogFieldPolicy(input: {
    currentHandle?: string | null;
    currentTags?: string[];
    legacyTagsToRemove?: string[];
    shopifyImageCount: number;
    syncbayLegacyTags: string[];
  }) {
    const exactRemovals = new Set([
      ...input.syncbayLegacyTags,
      ...(input.legacyTagsToRemove ?? []),
    ]);
    const currentTags = input.currentTags ?? [];

    return {
      handle: {
        operation: "preserve" as const,
        redirectRequired: false,
      },
      images: {
        operation:
          input.shopifyImageCount > 0
            ? ("preserve" as const)
            : ("sync_from_ebay_if_available" as const),
      },
      tags: {
        add: ["Negozio eBay"],
        preserve: currentTags.filter((tag) => !exactRemovals.has(tag)),
        remove: currentTags.filter((tag) => exactRemovals.has(tag)),
      },
    };
  }
  ```

- [x] **Step 3: includere policy nel report**

  Ogni riga `ExistingCatalogTakeoverRow` deve includere:

  ```ts
  fieldPolicy: ReturnType<typeof buildExistingCatalogFieldPolicy>;
  ```

  Le operazioni automatiche non modificano regole di collezione. Aggiungere copy UI:

  ```tsx
  <s-text color="subdued">
    Le collezioni automatiche non vengono modificate: SyncBay aggiorna solo i
    campi prodotto usati dalle regole esistenti.
  </s-text>
  ```

- [x] **Step 4: aggiungere input allowlist tag legacy nell'apply**

  In UI, mostrare un campo testo opzionale:

  ```tsx
  <s-text-field
    label="Tag legacy da rimuovere"
    name="legacyTagsToRemove"
    placeholder="Tag esatto 1, Tag esatto 2"
  />
  ```

  In action, normalizzare con split su virgola, trim, dedupe, massimo 50 tag.

- [x] **Step 5: verifiche e commit**

  Run:

  ```bash
  node --test --experimental-strip-types app/lib/syncbay-existing-catalog-field-policy.test.ts
  npm run test:lib
  npm run typecheck
  npm run lint
  git diff --check
  ```

  Commit:

  ```bash
  git add app/lib/syncbay-existing-catalog-field-policy.ts app/lib/syncbay-existing-catalog-field-policy.test.ts app/lib/syncbay-existing-catalog-takeover.ts app/routes/app.import-preview.tsx
  git commit -m "feat: add existing catalog field policies"
  ```

## Task 8: Readiness Legale E Mini Kit 1.0

**Files:**

- Modify: `app/routes/privacy.tsx`
- Create: `app/routes/terms.tsx`
- Modify: `docs/guides/onboarding-e-import.md`
- Modify: `docs/INDEX.md`
- Modify: `CHANGELOG.md`
- Modify after release: `app/lib/version.ts`

- [x] **Step 1: aggiornare privacy da provvisoria pilota a 1.0 privata**

  Cambiare heading da `Informativa privacy provvisoria` a `Informativa privacy SyncBay`. Mantenere il tono veritiero: custom app privata per clienti selezionati, non App Store pubblico.

  La pagina deve dichiarare almeno:

  - dati shop Shopify;
  - dati catalogo eBay e Shopify;
  - token provider cifrati a riposo;
  - log, job, audit, mapping, snapshot e conflitti;
  - ordini Shopify pagati limitati ai dati necessari per aggiornare disponibilità eBay;
  - retention rimandata ad ADR 0017/0018;
  - contatto maintainer.

- [x] **Step 2: creare termini minimi**

  `app/routes/terms.tsx` deve usare `AppProvider embedded={false}` come `privacy.tsx` e sezioni:

  - `Servizio`;
  - `Responsabilità del negoziante`;
  - `Fonte di verità eBay`;
  - `Limiti 1.0 privata`;
  - `Errori, conflitti e verifica`;
  - `Sospensione o disinstallazione`;
  - `Contatto`.

  Copy chiave:

  ```tsx
  <s-text>
    SyncBay 1.0 privata è fornita a clienti selezionati per collegare eBay.it a
    Shopify. eBay resta la sorgente di verità del catalogo; Shopify viene
    riallineato secondo impostazioni, preview e conferme operative.
  </s-text>
  ```

- [x] **Step 3: aggiungere mini kit alla guida onboarding esistente**

  In `docs/guides/onboarding-e-import.md`, aggiungere una sezione `Mini kit
clienti selezionati 1.0` con:

  - promessa prodotto;
  - requisiti prima dell'installazione;
  - limiti 1.0;
  - checklist onboarding;
  - cosa succede durante freeze;
  - cosa controllare dopo apply;
  - cosa fare se SyncBay segnala eccezioni;
  - link privacy e termini.

- [x] **Step 4: verifiche e commit**

  Run:

  ```bash
  npm run typecheck
  npm run lint
  npm run build
  npm run release
  npm run release:dry-run
  git diff --check
  ```

  Commit:

  ```bash
  git add app/routes/privacy.tsx app/routes/terms.tsx docs/guides/onboarding-e-import.md docs/INDEX.md CHANGELOG.md app/lib/version.ts docs/superpowers/plans/2026-06-21-syncbay-1-0-existing-catalog-takeover.md
  git commit -m "feat: add private 1.0 readiness materials"
  ```

## Task 9: Release Privata 1.0 Completa Prima Di Numisleo

**Files:**

- Modify: `docs/decisions/0020-1-0-custom-privata-catalogo-esistente.md`
- Modify: `docs/guides/onboarding-e-import.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify after release: `app/lib/version.ts`

- [ ] **Step 1: aggiornare runbook con boundary release 1.0 e azioni UI reali**

  Inserire nella guida e nell'ADR 0020 una sezione `Release privata 1.0 prima
dell'onboarding` che renda esplicita questa sequenza, senza introdurre
  logiche hardcoded nell'app:

  1. SyncBay deve arrivare a `1.0.0` prima di essere installata su Numisleo;
  2. la 1.0 è una custom app privata completa, non una App Store release;
  3. nessun onboarding cliente parte se Vercel, Supabase, privacy, termini,
     runbook, test e release non sono verdi;
  4. Numisleo usa la 1.0 come primo onboarding reale post-release;
  5. se durante Numisleo emergono bug, si rilascia una patch `1.0.1+`, non si
     ridefinisce retroattivamente la 1.0.

  Inserire anche i nomi reali delle azioni UI:

  - `Importazione -> Collega catalogo esistente`;
  - `Genera preview live`;
  - `Applica takeover righe sicure`;
  - `Attività -> job IMPORT_CATALOG`;
  - `Catalogo -> Da controllare`;
  - `Conflitti -> Batch sicuri / Da rivedere / Manuali`;
  - `Impostazioni -> Sync automatico`;
  - `Impostazioni -> Stato prodotti`;
  - `Impostazioni -> Pubblicazioni Shopify`;
  - `Impostazioni -> Regola prezzo`;
  - `Impostazioni -> Regola descrizione`.

- [ ] **Step 2: eseguire gate standard locale**

  Run:

  ```bash
  npm run test:lib
  npm run prisma:validate
  npm run typecheck
  npm run lint
  npm run build
  npm run release:dry-run
  git diff --check
  ```

  Expected: tutti PASS. Se `npm run release:dry-run` segnala una sezione
  versionata in `CHANGELOG.md`, eseguire `npm run release` prima della
  pubblicazione di questo task.

- [ ] **Step 3: verificare runtime production prima dell'installazione**

  Run:

  ```bash
  vercel list syncbay --environment production --format json --yes --no-color
  npm run db:verify
  ```

  Expected:

  - deployment Vercel production `READY` sul commit `main` corrente;
  - `npm run db:verify` PASS;
  - nessun blocco provider `402 exceed_egress_quota`.

  Se Supabase restituisce `402 exceed_egress_quota`, fermare Task 9: non
  dichiarare `1.0.0`, non installare su Numisleo e registrare il blocco nel
  riepilogo operativo.

- [ ] **Step 4: verificare superfici pubbliche e installabilità senza cliente**

  Aprire e verificare:

  - `https://syncbay.vercel.app`;
  - `https://syncbay.vercel.app/privacy`;
  - `https://syncbay.vercel.app/terms`.

  Verificare inoltre che il form pubblico di accesso esponga il campo `Dominio
shop` e che il deployment production sia quello candidato a `1.0.0`.

  Expected:

  - home pubblica raggiungibile;
  - privacy e termini raggiungibili;
  - nessun claim App Store pubblico o billing pubblico;
  - nessuna installazione Numisleo eseguita.

- [ ] **Step 5: preparare release locale 1.0.0**

  Prima della release, assicurarsi che il blocco `[Non rilasciato]` contenga la
  sezione versionata corretta per `1.0.0` e che le note solo documentali restino
  sotto `Non versionato` quando non fanno parte della release prodotto.

  Run:

  ```bash
  npm run release -- --version 1.0.0
  npm run release:dry-run
  ```

  Expected:

  - `CHANGELOG.md` contiene `## [1.0.0] — <data release>`;
  - `app/lib/version.ts` contiene `APP_VERSION = "1.0.0"`;
  - il tag previsto nello step successivo è `v1.0.0`, allineato alla versione
    generata dal comando release;
  - il secondo `release:dry-run` riporta `Categoria: non versionato. Nessuna
release SemVer da preparare.`;
  - nessuna installazione Numisleo eseguita.

- [ ] **Step 6: publish, deploy, tag e GitHub Release 1.0.0**

  Pubblicare secondo AGENTS.md e ADR 0008, perché `1.0.0` è una release
  prodotto reale privata:

  - branch dedicata;
  - PR verso `main`;
  - self-review diff;
  - controllo Codex feedback inbox/preflight;
  - merge su `main`;
  - verifica CI `main`;
  - verifica Vercel production `READY` sul commit mergeato;
  - tag Git `v1.0.0`;
  - GitHub Release `v1.0.0`;
  - cleanup branch/worktree.

  Expected: esiste una release privata `1.0.0` pubblicata su GitHub, deployata
  in production e installabile. Numisleo non è ancora installato.

- [ ] **Step 7: produrre handoff installazione Numisleo**

  Aggiornare il riepilogo operativo con:

  - versione installabile: `1.0.0`;
  - URL production;
  - stato Vercel;
  - stato Supabase;
  - link privacy e termini;
  - link GitHub Release;
  - blocchi residui pari a zero oppure no-go esplicito.

  Expected: Task 9 chiuso significa SyncBay `1.0.0` completa prima di
  installare su Numisleo.

## Task 10: Onboarding Numisleo Post-1.0, Installazione E Dry-Run Read-Only

**Stato 2026-07-04:** completato operativamente e chiuso come gate di
onboarding/readiness Numisleo. Evidenza non segreta salvata fuori repo in
`/Users/Matteo/SyncBay-audit/numisleo.myshopify.com/20260704-195513Z-task10-closure/`.
La paginazione esatta della collezione `Negozio Online` conferma 883 prodotti
listati, 883 mappati SyncBay/eBay, zero prodotti extra fuori mapping e zero
mapping mancanti dalla collezione. Eventuali discrepanze di conteggio Shopify
devono essere ricontrollate confrontando connection paginabile, source a
condizioni, `productsCount(query: "collection_id:...")` e storefront, senza
assumere che il campo aggregato `Collection.productsCount` sia da solo
sufficiente come gate. Apply reale, coda pricing `-8%`, coda
`DETECT_SHOPIFY_CHANGES`, conferma disattivazione vecchia app e monitoraggio
go-live restano responsabilità di Task 11.

**Files:**

- No repo file for raw evidence: salvare output, screenshot e JSON in una
  cartella fuori repo o ignorata, per esempio
  `/Users/Matteo/SyncBay-audit/numisleo.myshopify.com/$YYYYMMDD-HHMM/`.
- Modify only if the runbook changes: `docs/guides/onboarding-e-import.md`
- Modify only if the ADR changes: `docs/decisions/0020-1-0-custom-privata-catalogo-esistente.md`

- [x] **Step 1: verificare prerequisito release**

  Prima di toccare Numisleo, verificare:

  - Task 9 completato;
  - tag `v1.0.0` e GitHub Release presenti;
  - Vercel production `READY` sulla release installabile;
  - Supabase operativo, senza `402 exceed_egress_quota`;
  - nessun hotfix non rilasciato necessario.

  Expected: se manca un punto, fermare l'onboarding e chiudere prima una patch
  `1.0.1+` o la release `1.0.0`.

- [x] **Step 2: creare cartella run reale fuori repo**

  Run:

  ```bash
  export SYNCBAY_TAKEOVER_SHOP_DOMAIN="numisleo.myshopify.com"
  export SYNCBAY_TAKEOVER_RUN_DIR="/Users/Matteo/SyncBay-audit/numisleo.myshopify.com/$(date +%Y%m%d-%H%M)"
  mkdir -p "$SYNCBAY_TAKEOVER_RUN_DIR"
  ```

  Expected: la cartella esiste fuori dal repo e conterrà solo evidenze locali
  non committate.

- [x] **Step 3: installare/autorizzare SyncBay su Numisleo senza apply**

  Con browser autenticato sullo store, aprire il deployment production e
  completare OAuth Shopify per:

  ```text
  numisleo.myshopify.com
  ```

  Percorso operativo:

  1. aprire `https://syncbay.vercel.app`;
  2. inserire `numisleo.myshopify.com` nel form `Dominio shop`;
  3. completare la schermata autorizzazione Shopify;
  4. arrivare alla home embedded SyncBay;
  5. non avviare import, preview live o apply in questo step.

  Expected: SyncBay `1.0.0` o patch successiva risulta installata/autorizzata
  sullo store Numisleo e la home embedded carica senza errori runtime.

- [x] **Step 4: verificare sessione, scope, webhook, location e pagine pubbliche**

  Usare letture e diagnostica, senza scrivere catalogo:

  ```bash
  test -n "$SYNCBAY_TAKEOVER_SHOP_DOMAIN"
  shopify store execute --store "$SYNCBAY_TAKEOVER_SHOP_DOMAIN" --query 'query SyncBayTakeoverReadiness { shop { name myshopifyDomain } locations(first: 5) { nodes { id name isActive } } products(first: 5) { nodes { id title handle tags status } } }' --version 2026-07 --json
  ```

  Aprire inoltre:

  - `https://syncbay.vercel.app/privacy`;
  - `https://syncbay.vercel.app/terms`;
  - home embedded SyncBay su Numisleo;
  - tab `Impostazioni`.

  Expected:

  - store domain corretto;
  - una location Shopify attiva scelta come default;
  - nessuno scope richiesto da SyncBay mancante;
  - webhook registrabili senza errore;
  - privacy e termini raggiungibili;
  - nessuna scrittura catalogo eseguita.

- [x] **Step 5: collegare eBay e impostazioni iniziali Numisleo**

  Dalla UI SyncBay su Numisleo:

  1. collegare l'account eBay.it corretto;
  2. verificare che il marketplace operativo sia eBay.it;
  3. impostare stato prodotti, pubblicazioni Shopify, regola prezzo e regola
     descrizione secondo le impostazioni SyncBay concordate;
  4. impostare target sync automatico a 300 secondi, ma non considerarlo go-live
     finché Task 11 non ha completato apply e verifica;
  5. annotare in un report fuori repo le impostazioni effettive.

  Expected: Numisleo ha Shopify + eBay autorizzati dentro SyncBay e le
  impostazioni base sono pronte per il dry-run, senza apply catalogo.

- [x] **Step 6: verificare letture Shopify ed eBay senza scritture**

  Run:

  ```bash
  shopify store execute --store "$SYNCBAY_TAKEOVER_SHOP_DOMAIN" --query 'query SyncBayTakeoverReadiness { products(first: 5) { nodes { id title handle tags status } } }' --version 2026-07 --json > "$SYNCBAY_TAKEOVER_RUN_DIR/shopify-readiness-products.json"
  ```

  Dalla UI SyncBay, verificare che il collegamento eBay risulti attivo e che la
  preview live possa leggere i listing eBay.it. Il conteggio autorevole dei
  listing attivi resta quello restituito da Trading API/GetMyeBaySelling, non il
  totale storico dei prodotti Shopify.

  Expected: letture Shopify ed eBay funzionanti, nessuna scrittura catalogo,
  nessun job apply creato.

- [x] **Step 7: generare preview live in modalità catalogo esistente**

  Dalla UI SyncBay:

  1. aprire `Importazione`;
  2. scegliere `Collega catalogo esistente`;
  3. avviare `Genera preview live`;
  4. attendere la fine del caricamento;
  5. salvare fuori repo screenshot e report con conteggi.

  Expected:

  - il dry-run copre tutti i listing eBay attivi entro il limite MVP 2.000;
  - nessun prodotto Shopify viene creato;
  - nessun mapping viene scritto se non previsto dalla preview read-only;
  - il report espone `applicabile`, `da_rivedere`, `bloccante`,
    `gia_collegato`.

- [x] **Step 8: riconciliare report con audit Task 0**

  Confrontare il nuovo report con l'audit già salvato in
  `audits/numisleo.myshopify.com/20260621-2239/` e classificare almeno:

  - listing eBay attivi mancanti da Shopify;
  - prodotti Shopify con stock 0 ma eBay attivo;
  - prodotti Shopify `DRAFT` con stock positivo ma non eBay attivo;
  - match multipli o ambigui;
  - varianti inattese;
  - prezzo o disponibilità non affidabili;
  - descrizioni/template da sanificare;
  - immagini mancanti, rotte o incoerenti;
  - categorie, `productType`, metafield, faccette e tag legacy.

  Expected: ogni riga è `applicabile`, `da_rivedere`, `bloccante` o
  `gia_collegato`, con motivazione leggibile.

- [x] **Step 9: decidere freeze e vecchia app**

  Prima di disattivare la vecchia app o applicare SyncBay, verificare:

  1. export segnali legacy completato;
  2. report dry-run salvato fuori repo;
  3. righe `bloccante` pari a zero oppure no-go documentato;
  4. finestra operativa di freeze confermata;
  5. nessuna modifica manuale prevista su eBay o Shopify durante il freeze;
  6. decisione esplicita su disattivazione vecchia app prima dell'apply.

  Expected: esiste un pacchetto go/no-go. Se una condizione manca, Task 10 non
  è chiuso e Task 11 non parte.

- [x] **Step 10: publish eventuali patch 1.0.1+ o correzioni runbook**

  Se il dry-run reale rivela bug applicativi, correggerli e rilasciarli come
  patch `1.0.1+` prima di procedere. Se rivela solo istruzioni mancanti o
  fuorvianti, aggiornare guida/ADR e pubblicare secondo AGENTS.md. Non
  committare evidenze reali, export, screenshot o JSON del negoziante.

## Task 11: Apply Controllato, Attivazione Sync E Monitoraggio Numisleo

**Stato 2026-07-04:** in corso, non ancora chiudibile. Evidenza read-only
salvata fuori repo in
`/Users/Matteo/SyncBay-audit/numisleo.myshopify.com/20260704-200253Z-task11-status/`.
Il takeover è applicato: `ProductMapping` ha 883 mapping attivi, 883 ItemID
eBay distinti, 883 prodotti Shopify distinti e nessun GID Shopify mancante. La
collezione `Negozio Online`, verificata con paginazione esatta, lista 883
prodotti, tutti mappati, attivi, pubblicati e con URL storefront; la pagina
pubblica con cache-bust mostra `883 prodotti`. Non risultano conflitti o job in
`FAILED`/`RETRYING`. Restano però pendenti 83 job `SYNC_INCREMENTAL`
`pricing_rule_update` per 823 item e 1071 job `DETECT_SHOPIFY_CHANGES`; non
cancellarli né forzarli, lasciarli drenare. Nel campione prezzi live 60/150
prodotti hanno già prezzo Shopify con `-8%` e `compareAtPrice` eBay, mentre
90/150 devono ancora ricevere il riallineamento. Restano aperte anche la
verifica manuale finale catalogo e la conferma che la vecchia app sia fuori dal
flusso.

**Aggiornamento 2026-07-04:** l'operatore ha confermato che la verifica
manuale finale non è richiesta per chiudere il gate e che la vecchia app è già
stata rimossa. L'app precedente è quindi considerata fuori dal flusso sulla base
della conferma operatore, non di verifica API `read_apps`. Il residuo Task 11
resta il drenaggio naturale dei job pendenti e la conferma finale sync quando
le code sono stabilizzate.

**Chiusura definitiva 2026-07-05:** Task 11 completato. Verifiche runtime live:
shop `numisleo.myshopify.com` `INSTALLED`, eBay `CONNECTED` in produzione su
`EBAY_IT`, sync ordinario attivo con target 300 secondi, location predefinita
presente, cron runner ripristinato al batch conservativo `limit=2`. Il DB
SyncBay ha 883 mapping `ACTIVE`, 883 ItemID eBay distinti, 883 prodotti Shopify
distinti e nessun GID Shopify mancante; tutti i job Numisleo risultano
terminali (`SUCCEEDED`), senza `PENDING`, `RUNNING`, `RETRYING` o `FAILED`.
La regola prezzo `-8%` è stata applicata a 883/883 prodotti (`syncedCount`
883, `skippedCount` 0). La coda `DETECT_SHOPIFY_CHANGES` generata dal takeover
e dal riallineamento prezzi è stata chiusa: 2.159 webhook su prodotti non
mappati erano non applicabili, 865 erano superati da snapshot SyncBay
successivi e i 5 residui sono stati processati dal runner reale. I 18 conflitti
`status` aperti dal runner erano falsi positivi di normalizzazione
`published`/`ACTIVE`; sono stati risolti e la patch applicativa normalizza
questo caso per evitare riaperture. Shopify Admin GraphQL conferma 0 bozze e 0
prodotti archiviati. Verifica mirata sulla collezione `Negozio Online`: il
campo aggregato `Collection.productsCount` riporta 965, ma
`productsCount(query: "collection_id:202631315501")`, la paginazione completa di
`collection.products`, la paginazione completa della `CollectionConditionsSource`
e lo storefront pubblico con cache-bust convergono tutti a 883 prodotti. La
source della collezione include solo `VariantInventory GREATER_THAN 0` e non ha
condizioni o selezioni di esclusione; anche `productsCount(query:
"inventory_total:>0")` restituisce 883. Non è quindi dimostrato un gruppo di 82
prodotti extra effettivamente pubblicati o paginabili: il `965` resta un
aggregato Shopify incoerente/lagging rispetto alle superfici operative, da
monitorare ma non bloccante per Task 11.

**Files:**

- No repo file for raw evidence: report apply, screenshot, log e JSON restano
  fuori repo o in cartelle ignorate.
- Modify only if documentation changes: `docs/guides/onboarding-e-import.md`
- Modify only if a stable decision changes: `docs/decisions/`

- [x] **Step 1: confermare go prima di ogni scrittura**

  Prima di applicare, verificare e registrare fuori repo:

  - Task 9 completato;
  - Task 10 completato;
  - Numisleo installato su SyncBay `1.0.0` o patch successiva rilasciata;
  - Supabase e Vercel production operativi;
  - `existingCatalogTakeover.summary.blocked === 0`;
  - vecchia app disattivata o lasciata attiva con motivo documentato;
  - freeze operativo attivo;
  - approvazione esplicita dell'operatore per applicare righe sicure.

  Expected: senza questi punti, non premere `Applica takeover righe sicure`.

- [x] **Step 2: applicare solo righe sicure**

  Dalla UI SyncBay:

  1. aprire il report dry-run valido più recente;
  2. verificare conteggi e filtri;
  3. inserire la conferma `COLLEGA`;
  4. premere `Applica takeover righe sicure`;
  5. salvare fuori repo timestamp, conteggi e screenshot.

  Expected:

  - vengono pianificate solo righe applicabili;
  - righe `da_rivedere` e `bloccante` restano escluse;
  - ogni riga usa `reuseOnly`;
  - un mancato riuso fallisce la riga invece di creare duplicati.

- [x] **Step 3: monitorare job, mapping, snapshot e conflitti**

  Dalla UI e dagli strumenti diagnostici:

  - `Attività -> job IMPORT_CATALOG`;
  - `Catalogo`;
  - `Conflitti`;
  - diagnostica job/rate-limit;
  - eventuali log Vercel error/fatal.

  Expected:

  - job completati o errori classificati;
  - mapping `ProductMapping` coerenti con ItemID eBay;
  - snapshot salvati;
  - conflitti critici assenti;
  - nessun duplicato prodotto creato da SyncBay.

- [x] **Step 4: verifica manuale finale catalogo**

  L'operatore controlla manualmente:

  - prezzo;
  - disponibilità;
  - descrizione ripulita;
  - immagini;
  - URL/handle preservati o redirect espliciti;
  - categorie, `productType`, metafield e faccette;
  - tag legacy rimossi solo se in allowlist;
  - prodotti eBay inattivi gestiti come Shopify esauriti secondo ADR 0011.

  Expected: catalogo Shopify coerente con eBay per tutte le righe applicate e
  lista eccezioni aperte aggiornata.

  Stato: requisito rimosso/waived dall'operatore il 2026-07-04; la chiusura si
  basa sulle verifiche automatiche di mapping, collezione, disponibilità,
  prezzi progressivi e assenza conflitti.

- [x] **Step 5: attivare sync ordinario a 300 secondi**

  Solo dopo verifica manuale:

  1. attivare sync eBay -> Shopify;
  2. confermare target 300 secondi;
  3. verificare una run incrementale riuscita;
  4. verificare che `orders/paid` pianifichi `UPDATE_EBAY_STOCK` senza usare
     `orders/create`;
  5. mantenere report fuori repo per recovery manuale.

  Expected: SyncBay diventa l'unico gestore del flusso eBay.it -> Shopify per
  Numisleo, con stock Shopify -> eBay limitato agli ordini pagati.

  Stato finale: sync attivo a 300 secondi, eBay collegato in produzione,
  pricing `-8%` completato su 883/883 prodotti e vecchia app confermata fuori
  dal flusso dall'operatore. Il webhook `orders/paid` resta il solo percorso
  Shopify -> eBay previsto dal perimetro 1.0.

- [x] **Step 6: monitoraggio iniziale e chiusura onboarding**

  Nella prima finestra operativa controllare:

  - job falliti o in retry;
  - conflitti Shopify aperti;
  - rate-limit eBay;
  - ordini reali e aggiornamenti stock;
  - prodotti inattivi e out-of-stock;
  - eventuali segnalazioni del negoziante.

  Expected: nessun conflitto critico aperto, nessun job bloccato non spiegato,
  vecchia app fuori dal flusso, runbook aggiornato con gli esiti reali.

  Stato finale: 0 job aperti, 0 conflitti aperti, 0 bozze Shopify, 0 archiviati,
  883 prodotti SyncBay/eBay attivi e mappati. I falsi conflitti `status`
  `published`/`ACTIVE` sono stati corretti nel codice e risolti sul runtime.

## Sequenza Di Esecuzione Consigliata

0. Completato: Task 0 audit read-only dello store target e report operativo
   fuori repo.
1. Completato: Task 1-3 modalità + matching + report dry-run, senza scritture.
2. Completato: Task 4-5 caricamento Shopify paginato e UI dry-run completa.
3. Completato: Task 6-7 apply `reuseOnly`, tag policy e runner.
4. Completato: Task 8 readiness legale e mini kit clienti selezionati.
5. Completato: Task 9 come release privata `1.0.0` completa, deployata,
   taggata, pubblicata su GitHub Release e installabile, senza installare
   Numisleo.
6. Completato: Task 10 come onboarding Numisleo post-1.0: installazione,
   configurazione, dry-run read-only, classificazione eccezioni, pacchetto
   go/no-go, freeze e decisione sulla vecchia app.
7. Completato: Task 11 come apply controllato, attivazione sync a 300 secondi e
   monitoraggio iniziale.

Il piano 1.0/onboarding Numisleo è chiuso definitivamente: la capacità di
takeover generica è in produzione privata, Numisleo è installato e collegato,
il catalogo eBay.it gestito da SyncBay è attivo e le eccezioni runtime emerse
durante il go-live sono state risolte come patch `1.0.x`, non come nuovo scope
di prodotto.

## Copertura Decisioni Grill

Questa sezione verifica che le decisioni raccolte nel grill siano presenti nel
piano implementativo, senza trasformarle in logiche hardcoded per un singolo
store.

| Decisione raccolta                                                                            | Copertura nel piano                                                                                                                                 |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0 come custom app privata, App Store pubblico in 2.0                                        | `Non Obiettivi 1.0`, Task 8                                                                                                                         |
| Target eBay.it-only, cataloghi di numismatica/collezionismo con prodotti singoli              | `Target 1.0`, `Gate Release 1.0`, `Gate Onboarding Numisleo Post-1.0`                                                                               |
| Capacità generica, non Numisleo-specifica                                                     | `Architecture`, `Non Obiettivi 1.0`, Task 1                                                                                                         |
| Audit completo del primo store reale, inclusi frontend, backend Shopify e vecchia app di sync | Task 0                                                                                                                                              |
| 1.0 completa prima di installare su Numisleo; problemi Numisleo come 1.0.1+                   | Task 9, Task 10                                                                                                                                     |
| L'altra app verrà disattivata, anche prima se migliora il takeover                            | `Rischi E Mitigazioni`, Task 10, gate audit/dry-run/freeze                                                                                          |
| Audit sola lettura, dry-run, export segnali legacy e freeze prima dell'apply                  | Task 6, Task 10, Task 11, `Rischi E Mitigazioni`                                                                                                    |
| Tutti i prodotti entro limite MVP, non un campione                                            | `Target 1.0`; Task 4 carica fino a 2.000 prodotti; Task 5 costruisce il dry-run da tutti gli ItemID Trading API; Task 6 pianifica righe applicabili |
| Match automatico solo con segnali forti                                                       | Task 2, Task 3, `Definition Of Done`                                                                                                                |
| Casi incerti come eccezioni da rivedere                                                       | Task 3, UI Task 5                                                                                                                                   |
| Se eBay ha dato assente/vuoto/non affidabile, non svuotare Shopify                            | Task 3, `Rischi E Mitigazioni`                                                                                                                      |
| Prezzo e disponibilità riallineati a eBay quando validi                                       | Task 6, `Gate Onboarding Numisleo Post-1.0`                                                                                                         |
| Stato e pubblicazioni seguono impostazioni SyncBay                                            | Task 6 passa `importProductStatus` e riusa policy pubblicazioni esistente                                                                           |
| Stock Shopify -> eBay da `orders/paid`, non `orders/create`                                   | `Definition Of Done`, `Gate Release 1.0`, `Gate Onboarding Numisleo Post-1.0`; nessun task modifica il webhook                                      |
| Scrittura eBay rapida ma via runner/job esistente, non dentro webhook sincrono                | `Architecture`, `Definition Of Done`, `Gate Release 1.0`, `Gate Onboarding Numisleo Post-1.0`                                                       |
| Descrizioni/template da sistemare                                                             | Task 3 include descrizione nel report; Task 6 riusa update descrizione; Task 7 policy campi                                                         |
| Immagini non sostituite in massa                                                              | Task 7, `Rischi E Mitigazioni`                                                                                                                      |
| Categorie, `productType`, metafield e faccette applicabili dopo preview                       | Task 3, Task 6, Task 7                                                                                                                              |
| SEO title/description gestiti, handle preservato di default                                   | Task 3 pianifica `sync_seo`; Task 7 preserva handle                                                                                                 |
| Se cambia handle serve redirect                                                               | `Definition Of Done`; prima implementazione non cambia handle automaticamente                                                                       |
| Tag Shopify ripulibili, ma solo legacy/allowlist                                              | Task 7                                                                                                                                              |
| Regole collection esistenti preservate                                                        | Task 7, `Rischi E Mitigazioni`                                                                                                                      |
| Location Shopify unica esistente                                                              | `Non Obiettivi 1.0`, Task 6 usa `defaultLocationGid`                                                                                                |
| Varianti non supportate nel target, inattese come anomalie                                    | `Non Obiettivi 1.0`, Task 3 blocca `complex_variants`                                                                                               |
| Listing eBay inattivi restano Shopify esauriti, non cancellati/archiviati                     | `Gate Release 1.0`, `Gate Onboarding Numisleo Post-1.0`; invariant ADR 0011 da non modificare                                                       |
| Installazione privata SyncBay su Numisleo necessaria prima del dry-run reale                  | Task 10                                                                                                                                             |
| Dry-run reale su Numisleo prima dell'apply                                                    | Task 10                                                                                                                                             |
| Apply reale solo dopo conferma operatore e freeze                                             | Task 11                                                                                                                                             |
| Sync automatico dopo riallineamento, target 300 secondi                                       | `Gate Onboarding Numisleo Post-1.0`, Task 11                                                                                                        |
| Go-live bloccato da conflitti critici su mapping/prezzo/disponibilità                         | `Gate Onboarding Numisleo Post-1.0`, Task 5                                                                                                         |
| Recovery manuale, non rollback self-service 1.0                                               | `Non Obiettivi 1.0`, Task 6 snapshot/report                                                                                                         |
| Privacy generale, termini minimi e mini kit clienti selezionati                               | Task 8                                                                                                                                              |
| Verifica finale catalogo manuale                                                              | `Gate Onboarding Numisleo Post-1.0`, Task 11                                                                                                        |
| Integrare il minimo nel tab Importazione/prima configurazione senza gonfiare SyncBay          | `Architecture`, Task 1, sequenza PR 1-3 prima delle scritture                                                                                       |

## Rischi E Mitigazioni

- **Duplicati Shopify**: mitigato da `reuseOnly`, claim metafield e failure se il prodotto non viene riusato.
- **Match sbagliato**: titolo-only non auto-linkabile; match multiplo diventa bloccante.
- **Dato eBay assente che svuota Shopify**: prezzo/disponibilità invalidi bloccano; immagini mancanti restano review.
- **SEO URL**: handle preservati; redirect solo in una futura correzione esplicita.
- **Collezioni automatiche**: nessuna modifica alle regole; SyncBay aggiorna i campi prodotto.
- **Vecchia app ancora attiva**: apply solo dopo audit, dry-run, export segnali,
  freeze e decisione esplicita su disattivazione o mantenimento temporaneo.
- **Installazione confusa con release 1.0 o go-live**: Task 9 chiude la release
  installabile senza toccare Numisleo; Task 10 installa/autorizza SyncBay su
  Numisleo solo per creare sessione, token, configurazione e dry-run; l'apply
  resta Task 11.
- **1.0 confusa con collaudo Numisleo**: Task 9 chiude `1.0.0` prima
  dell'installazione cliente; se Numisleo rivela bug, si procede con patch
  `1.0.1+`.
- **Runtime provider bloccato**: Supabase `402 exceed_egress_quota` blocca
  release 1.0, installazione utile, dry-run reale e apply; non aggirare il
  blocco con comandi manuali non tracciati.
- **Audit incompleto**: Task 0 blocca l'apply finché storefront, Shopify Admin,
  vecchia app e catalogo eBay non sono stati verificati o il limite non è stato
  documentato.
- **Rate limit provider**: usare batch esistenti, retry/backoff e runner; non introdurre worker separati.

## Gate Release 1.0

- Tutti i Task 0-8 completati e pubblicati.
- Gate locale completo passato: `test:lib`, `prisma:validate`, `typecheck`,
  `lint`, `build`, `release:dry-run`, `git diff --check`.
- Vercel production `READY` sul commit `main` destinato alla release.
- Supabase operativo, senza `402 exceed_egress_quota` su DB/API necessari.
- Privacy e termini raggiungibili.
- Runbook onboarding aggiornato e coerente con i nomi reali delle azioni UI.
- `orders/paid` -> eBay stock operativo nel perimetro già verificabile senza
  installazione Numisleo.
- Listing eBay inattivi gestiti come Shopify esauriti secondo ADR 0011, senza
  cancellazione né archiviazione.
- Nessun claim App Store pubblico, billing pubblico o support policy pubblica.
- `CHANGELOG.md` e `app/lib/version.ts` chiusi su `1.0.0`.
- Tag Git `v1.0.0` e GitHub Release `v1.0.0` pubblicati.
- Deployment production verificato dopo merge della release.
- Nessuna installazione Numisleo eseguita prima della chiusura di questo gate.

## Gate Onboarding Numisleo Post-1.0

- Vercel production `READY` sul commit `main` corrente.
- Supabase operativo, senza `402 exceed_egress_quota` su DB/API necessari.
- SyncBay `1.0.0` o patch successiva rilasciata prima dell'installazione.
- SyncBay installata e autorizzata su `numisleo.myshopify.com`.
- Sessione Shopify, scope, webhook e location Numisleo verificati.
- Account eBay.it corretto collegato nello shop Numisleo.
- Impostazioni SyncBay iniziali confermate: stato prodotti, pubblicazioni,
  regola prezzo, regola descrizione e target sync 300 secondi.
- `existingCatalogTakeover.summary.blocked === 0`.
- Nessun conflitto aperto critico su mapping, prezzo o disponibilità.
- `orders/paid` -> eBay stock operativo e verificato.
- Sync eBay -> Shopify attivo con target 300 secondi.
- Audit completo read-only chiuso con report operativo fuori repo.
- Dry-run read-only Numisleo chiuso e report salvato fuori repo.
- Export segnali legacy vecchia app completato o limite documentato.
- Freeze operativo confermato prima dell'apply.
- Decisione esplicita su disattivazione vecchia app prima dell'apply.
- Listing eBay inattivi gestiti come Shopify esauriti secondo ADR 0011, senza
  cancellazione né archiviazione.
- Privacy e termini raggiungibili.
- Report dry-run/apply salvato fuori repo per recovery manuale.
- Verifica manuale finale del catalogo completata dall'operatore.
- Monitoraggio iniziale senza job bloccati, conflitti critici o duplicati
  creati da SyncBay.

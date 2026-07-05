# SyncBay Automatic Facet Inference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere automatica e prudente la compilazione delle cinque faccette prodotto `syncbay_facets.*`, usando inferenza deterministica SyncBay e non script manuali come flusso ordinario.

**Architecture:** SyncBay deve dedurre `Categoria`, `Area / Stato`, `Materiale`, `Conservazione` e `Perizia` da segnali osservabili, soprattutto titolo e categoria negozio, con regole versionate, confidenza ed evidenza. La scrittura Shopify deve essere idempotente: aggiorna valori mancanti o ancora allineati all'ultimo baseline SyncBay, ma non sovrascrive valori Shopify divergenti. Il runner `SYNC_INCREMENTAL` gestisce sia aggiornamento ordinario sia backfill automatico `facetOnly`, senza nuovi worker o code esterne.

**Tech Stack:** TypeScript, React Router services, Shopify Admin GraphQL `metafieldsSet`, Prisma/Postgres `SyncJob` e `ProductSnapshot`, Node test runner.

---

## Scope E Decisioni

Questo piano cambia una decisione pratica: eBay non va trattato come fonte strutturata affidabile per queste cinque faccette. SyncBay deve dedurre valori difendibili da titolo e segnali controllati.

Resta fuori scope:

- attivare filtri Shopify Search & Discovery;
- aggiungere AI/LLM runtime;
- importare tutti gli `ItemSpecifics`;
- creare nuove code, worker o runtime;
- estendere oltre le cinque faccette approvate.

## File Structure

- Modify: `docs/decisions/0016-faccette-storefront-import.md`
  - Aggiorna la decisione: fonte primaria = inferenza deterministica SyncBay; eBay structured fields = fonte opportunistica.
- Modify: `docs/syncbay-product-technical-plan.md`
  - Aggiorna comportamento runner/backfill e limite "solo high confidence".
- Modify: `docs/data-model.md`
  - Documenta baseline, confidence, evidence e protezione manual edits.
- Modify: `README.md`
  - Aggiorna descrizione sintetica delle faccette.
- Modify: `app/lib/syncbay-product-facets.ts`
  - Introduce inferenze con `confidence`, `source`, `evidence`, `ruleId`.
  - Mantiene `buildSyncBayProductFacets()` come wrapper compatibile che restituisce solo valori scrivibili automaticamente.
- Modify: `app/lib/syncbay-product-facets.test.ts`
  - Copre deduzione da titolo e non deduzione quando il segnale non basta.
- Create: `app/lib/syncbay-product-facet-sync-plan.ts`
  - Calcola cosa scrivere, cosa saltare e cosa classificare come conflitto manuale.
- Create: `app/lib/syncbay-product-facet-sync-plan.test.ts`
  - Testa idempotenza, baseline e protezione dei valori Shopify divergenti.
- Create: `app/services/syncbay-product-facets.server.ts`
  - Legge metafield correnti Shopify e applica il piano tramite `metafieldsSet`.
- Modify: `app/services/shopify-draft-import.server.ts`
  - Passa baseline facet per item e sincronizza metafield dopo update di prodotto riusato.
- Modify: `app/services/sync-job-runner.server.ts`
  - Aggancia facet sync al percorso full `SYNC_INCREMENTAL`.
  - Aggiunge modalità `facetOnly` per backfill automatico.
  - Pianifica backfill una tantum per mapping attivi senza usare lo script manuale.
- Modify: `scripts/syncbay-product-facets-backfill.mjs`
  - Declassa lo script a diagnostica/manual emergency e, se pratico, riusa il piano puro.
- Modify: `docs/TOOLCHAIN.md`
  - Chiarisce che `facets:backfill` non è più flusso ordinario.
- Check only, then modify only if supported without namespace migration: `shopify.app.toml`
  - Definizioni metafield versione-controllate. Prima della scrittura runtime va verificato se Shopify CLI supporta definizioni nel namespace esistente `syncbay_facets`. Se non lo supporta senza cambiare namespace, questa PR mantiene la scrittura runtime sui metafield esistenti e documenta il blocco.

---

### Task 0: Verificare Definizioni Metafield E Namespace

**Files:**
- Inspect: `shopify.app.toml`
- Modify only if Shopify CLI supports existing namespace safely: `shopify.app.toml`
- Modify if blocked: `docs/TOOLCHAIN.md`

- [ ] **Step 1: controlla configurazione app**

Run:

```bash
rg -n "metafield|syncbay_facets|\\[shopify\\.metafields|\\[metafields" shopify.app.toml docs app
```

Expected: existing runtime code uses namespace `syncbay_facets`; `shopify.app.toml` may not contain definitions yet.

- [ ] **Step 2: decidi se versionare le definizioni ora**

If Shopify CLI supports product metafield definitions with custom namespace `syncbay_facets`, add definitions for the five existing keys without changing namespace or key names:

```toml
# Shape intentionally illustrative: use the exact Shopify CLI schema supported by
# the installed CLI version before editing this file.
# Namespace and keys must remain:
# syncbay_facets.categoria
# syncbay_facets.area_stato
# syncbay_facets.materiale
# syncbay_facets.conservazione
# syncbay_facets.perizia
```

If the installed CLI only supports app-owned `$app` definitions or requires a namespace migration, do not edit `shopify.app.toml` in this implementation.

- [ ] **Step 3: documenta il blocco se le definizioni non sono versionabili**

If definitions cannot be safely added with namespace `syncbay_facets`, add this note to `docs/TOOLCHAIN.md` near the Shopify CLI section:

```markdown
Le definizioni Shopify dei metafield faccette restano da versionare appena la
toolchain consente di dichiarare il namespace esistente `syncbay_facets` senza
migrazione. Il runner può comunque scrivere i metafield prodotto già usati da
SyncBay; questa nota riguarda governance e Search & Discovery, non il backfill
automatico dei valori.
```

---

### Task 1: Documentare La Nuova Regola Di Prodotto

**Files:**
- Modify: `docs/decisions/0016-faccette-storefront-import.md`
- Modify: `docs/syncbay-product-technical-plan.md`
- Modify: `docs/data-model.md`
- Modify: `README.md`
- Modify: `docs/TOOLCHAIN.md`

- [ ] **Step 1: aggiorna ADR 0016**

Replace the current source paragraph in `docs/decisions/0016-faccette-storefront-import.md` with:

```markdown
Le fonti vengono valutate in questo ordine:

- titolo eBay, tramite regole deterministiche SyncBay con lista chiusa di
  pattern testati;
- categoria negozio eBay e categoria marketplace eBay come indizi per
  `Categoria`, non come fonte esaustiva;
- metafield Shopify esistenti e ultimo snapshot SyncBay come baseline per
  proteggere modifiche manuali;
- `ItemSpecifics` Trading API solo come fonte opportunistica quando presenti e
  coerenti con le regole SyncBay.

SyncBay scrive automaticamente solo valori ad alta confidenza. I valori a
confidenza media restano inferenze diagnostiche in memoria durante il calcolo,
ma in questa implementazione non vengono scritti né persistiti come storefront:
potranno diventare diagnostica persistita solo con una decisione UI dedicata.
I valori a bassa confidenza non vengono scritti.
```

- [ ] **Step 2: esplicita il divieto di deduzione forzata**

Add this paragraph after the current `Perizia` paragraph:

```markdown
L'obiettivo non è compilare sempre tutte le faccette. L'obiettivo è compilare
solo i valori che SyncBay può difendere con evidenza leggibile: token, frase,
categoria sorgente o regola applicata. Se l'evidenza manca, il metafield resta
assente.
```

- [ ] **Step 3: aggiorna piano tecnico**

In `docs/syncbay-product-technical-plan.md`, replace the paragraph starting with `Decisione attuale: ADR 0016.` in the faccette section with:

```markdown
Decisione attuale: ADR 0016. Le faccette vengono dedotte principalmente da
titolo eBay con regole deterministiche SyncBay. Categoria negozio, categoria
marketplace e `ItemSpecifics` Trading API restano indizi opportunistici, ma il
runner non dipende da campi strutturati eBay per compilare i cinque metafield.
I valori scritti nel namespace `syncbay_facets` devono avere confidenza alta e
vengono salvati nel payload diagnostico con evidenza e regola applicata.
SyncBay non crea tag filtro e non deduce valori mancanti da descrizione HTML o
assenza del campo.
```

- [ ] **Step 4: aggiorna data model**

In `docs/data-model.md`, replace the faccette paragraph with:

```markdown
- faccette storefront dedotte da SyncBay: `Categoria`, `Area / Stato`,
  `Materiale`, `Conservazione`, `Perizia`. Ogni inferenza mantiene valore,
  confidenza, fonte, evidenza e `ruleId`. Solo le inferenze ad alta confidenza
  vengono trasformate in `productFacets` e scritte su Shopify come metafield
  prodotto `syncbay_facets.*`. I baseline per proteggere modifiche manuali
  devono essere letti solo da snapshot che contengono davvero `productFacets`:
  snapshot `EBAY` come baseline storica dell'import e snapshot `SYNCBAY` creati
  dopo scritture automatiche riuscite.
```

- [ ] **Step 5: aggiorna README e toolchain**

In `README.md`, adjust the current sentence about five facets so it says:

```markdown
cinque faccette storefront `syncbay_facets.*` dedotte da SyncBay con regole
deterministiche su titolo, categoria e indizi disponibili, senza dipendere da
campi eBay strutturati completi
```

In `docs/TOOLCHAIN.md`, update the `facets:backfill` paragraph to say:

```markdown
`npm run facets:backfill` resta uno strumento diagnostico o di emergenza. Il
flusso ordinario di compilazione faccette passa dal runner `SYNC_INCREMENTAL`
e dai job automatici `facetOnly`.
```

- [ ] **Step 6: verifica docs**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

---

### Task 2: Rendere Esplicita L'Inferenza Deterministica

**Files:**
- Modify: `app/lib/syncbay-product-facets.ts`
- Modify: `app/lib/syncbay-product-facets.test.ts`

- [ ] **Step 1: aggiungi i tipi di inferenza**

At the top of `app/lib/syncbay-product-facets.ts`, after `SyncBayProductFacetKey`, add:

```ts
export type SyncBayProductFacetConfidence = "high" | "medium" | "low";

export type SyncBayProductFacetSource =
  | "title_rule"
  | "category_hint"
  | "ebay_specific";

export interface SyncBayProductFacetInference extends SyncBayProductFacet {
  confidence: SyncBayProductFacetConfidence;
  evidence: string[];
  ruleId: string;
  source: SyncBayProductFacetSource;
}
```

- [ ] **Step 2: aggiungi builder inferenze**

Add a new exported function before `buildSyncBayProductFacets`:

```ts
export function buildSyncBayProductFacetInferences(
  input: SyncBayProductFacetInput,
): SyncBayProductFacetInference[] {
  return FACETS.flatMap((facet) => {
    const inference = getFacetInference(facet.key, input, facet.aliases);
    if (!inference) return [];

    const normalizedValues =
      facet.key === "perizia"
        ? normalizePeriziaValues(inference.values)
        : inference.values;
    const productFacet = buildFacet({
      key: facet.key,
      label: facet.label,
      values: normalizedValues,
    });
    if (!productFacet) return [];

    return [
      {
        ...productFacet,
        confidence: inference.confidence,
        evidence: inference.evidence,
        ruleId: inference.ruleId,
        source: inference.source,
      },
    ];
  });
}
```

- [ ] **Step 3: mantieni compatibilità del writer attuale**

Replace the body of `buildSyncBayProductFacets` with:

```ts
export function buildSyncBayProductFacets(
  input: SyncBayProductFacetInput,
): SyncBayProductFacet[] {
  return buildSyncBayProductFacetInferences(input).flatMap((inference) =>
    inference.confidence === "high"
      ? [
          {
            key: inference.key,
            label: inference.label,
            namespace: inference.namespace,
            type: inference.type,
            value: inference.value,
          },
        ]
      : [],
  );
}
```

- [ ] **Step 4: implementa priorità titolo prima di eBay structured fields**

Add this helper near `getFacetValues`:

```ts
function getFacetInference(
  key: SyncBayProductFacetKey,
  input: SyncBayProductFacetInput,
  aliases: readonly string[],
):
  | {
      confidence: SyncBayProductFacetConfidence;
      evidence: string[];
      ruleId: string;
      source: SyncBayProductFacetSource;
      values: string[];
    }
  | null {
  const titleValues = getTitleFacetValues(key, input.title);
  if (titleValues.length > 0) {
    return {
      confidence: "high",
      evidence: [input.title ?? ""].filter(Boolean),
      ruleId: `title:${key}`,
      source: "title_rule",
      values: titleValues,
    };
  }

  if (key === "categoria") {
    const storefrontCategory = getStorefrontCategoryValue(input.storeCategoryName);
    if (storefrontCategory) {
      return {
        confidence: "high",
        evidence: [input.storeCategoryName ?? ""].filter(Boolean),
        ruleId: "category_hint:store",
        source: "category_hint",
        values: [storefrontCategory],
      };
    }

    const marketplaceCategory = getStorefrontCategoryValue(
      input.ebayPrimaryCategoryName,
    );
    if (marketplaceCategory) {
      return {
        confidence: "medium",
        evidence: [input.ebayPrimaryCategoryName ?? ""].filter(Boolean),
        ruleId: "category_hint:marketplace",
        source: "category_hint",
        values: [marketplaceCategory],
      };
    }
  }

  const specificValues = getSpecificValues(input.itemSpecifics ?? [], aliases);
  if (specificValues.length > 0) {
    return {
      confidence: "medium",
      evidence: specificValues,
      ruleId: `ebay_specific:${key}`,
      source: "ebay_specific",
      values: specificValues,
    };
  }

  return null;
}
```

Then remove direct calls to `getFacetValues` from the write path. Keep `getFacetValues` only if existing tests still need it indirectly; otherwise delete it after tests pass.

- [ ] **Step 5: aggiungi test per high confidence**

Add to `app/lib/syncbay-product-facets.test.ts`:

```ts
test("marks title-derived facet values as high confidence inferences", () => {
  assert.deepEqual(
    buildSyncBayProductFacetInferences({
      title:
        "NL* VEIII 5 Lire ARGENTO AQUILOTTO 1928 BB/SPL Perizia",
    }).map((inference) => ({
      confidence: inference.confidence,
      key: inference.key,
      source: inference.source,
      value: inference.value,
    })),
    [
      {
        confidence: "high",
        key: "categoria",
        source: "title_rule",
        value: "Monete italiane in lire",
      },
      {
        confidence: "high",
        key: "materiale",
        source: "title_rule",
        value: JSON.stringify(["Argento"]),
      },
      {
        confidence: "high",
        key: "conservazione",
        source: "title_rule",
        value: JSON.stringify(["BB", "SPL"]),
      },
      {
        confidence: "high",
        key: "perizia",
        source: "title_rule",
        value: "Con perizia",
      },
    ],
  );
});
```

- [ ] **Step 6: aggiungi test per eBay specific opportunistico**

Add:

```ts
test("keeps eBay item specifics as medium confidence suggestions", () => {
  const inferences = buildSyncBayProductFacetInferences({
    itemSpecifics: [
      { name: "Materiale", values: ["Argento"] },
      { name: "Conservazione", values: ["FDC"] },
    ],
  });

  assert.deepEqual(
    inferences.map((inference) => ({
      confidence: inference.confidence,
      key: inference.key,
      source: inference.source,
    })),
    [
      { confidence: "medium", key: "materiale", source: "ebay_specific" },
      { confidence: "medium", key: "conservazione", source: "ebay_specific" },
    ],
  );
  assert.deepEqual(buildSyncBayProductFacets({ itemSpecifics: [
    { name: "Materiale", values: ["Argento"] },
    { name: "Conservazione", values: ["FDC"] },
  ] }), []);
});
```

- [ ] **Step 7: run mirato**

Run:

```bash
node --experimental-strip-types --test app/lib/syncbay-product-facets.test.ts
```

Expected: all tests pass.

---

### Task 3: Creare Il Piano Di Scrittura Idempotente

**Files:**
- Create: `app/lib/syncbay-product-facet-sync-plan.ts`
- Create: `app/lib/syncbay-product-facet-sync-plan.test.ts`

- [ ] **Step 1: crea il file di piano**

Create `app/lib/syncbay-product-facet-sync-plan.ts`:

```ts
import type {
  ShopifyProductFacetMetafield,
  SyncBayProductFacet,
} from "./syncbay-product-facets";

export interface CurrentProductFacetMetafield {
  key: string;
  namespace: string;
  type: string;
  value: string;
}

export interface ProductFacetSyncPlan {
  conflicts: ShopifyProductFacetMetafield[];
  deletes: Array<{
    key: string;
    namespace: string;
  }>;
  skipped: Array<{
    key: string;
    reason: "evidence_missing" | "manual_conflict" | "not_high_confidence";
  }>;
  writes: ShopifyProductFacetMetafield[];
}

export function buildProductFacetSyncPlan(input: {
  currentMetafields: CurrentProductFacetMetafield[];
  previousSyncBayFacets: SyncBayProductFacet[];
  proposedFacets: SyncBayProductFacet[];
}): ProductFacetSyncPlan {
  const currentByKey = new Map(
    input.currentMetafields.map((metafield) => [
      `${metafield.namespace}:${metafield.key}`,
      metafield,
    ]),
  );
  const previousByKey = new Map(
    input.previousSyncBayFacets.map((facet) => [
      `${facet.namespace}:${facet.key}`,
      facet,
    ]),
  );
  const proposedByKey = new Map(
    input.proposedFacets.map((facet) => [
      `${facet.namespace}:${facet.key}`,
      facet,
    ]),
  );
  const writes: ShopifyProductFacetMetafield[] = [];
  const deletes: ProductFacetSyncPlan["deletes"] = [];
  const conflicts: ShopifyProductFacetMetafield[] = [];
  const skipped: ProductFacetSyncPlan["skipped"] = [];

  const candidateKeys = new Set([
    ...proposedByKey.keys(),
    ...previousByKey.keys(),
  ]);

  for (const key of candidateKeys) {
    const facet = proposedByKey.get(key);
    const current = currentByKey.get(key);
    const previous = previousByKey.get(key);

    if (!facet) {
      if (
        current &&
        previous &&
        current.type === previous.type &&
        current.value === previous.value
      ) {
        deletes.push({ key: previous.key, namespace: previous.namespace });
        skipped.push({ key: previous.key, reason: "evidence_missing" });
      }
      continue;
    }

    if (!current) {
      writes.push(toMetafield(facet));
      continue;
    }

    if (current.type === facet.type && current.value === facet.value) {
      continue;
    }

    if (
      previous &&
      current.type === previous.type &&
      current.value === previous.value
    ) {
      writes.push(toMetafield(facet));
      continue;
    }

    conflicts.push(toMetafield(facet));
    skipped.push({ key: facet.key, reason: "manual_conflict" });
  }

  return { conflicts, deletes, skipped, writes };
}

function toMetafield(facet: SyncBayProductFacet): ShopifyProductFacetMetafield {
  return {
    key: facet.key,
    namespace: facet.namespace,
    type: facet.type,
    value: facet.value,
  };
}
```

- [ ] **Step 2: crea test piano sync**

Create `app/lib/syncbay-product-facet-sync-plan.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildProductFacetSyncPlan } from "./syncbay-product-facet-sync-plan.ts";

const materiale = {
  key: "materiale" as const,
  label: "Materiale",
  namespace: "syncbay_facets" as const,
  type: "list.single_line_text_field" as const,
  value: JSON.stringify(["Argento"]),
};

const materialeBronzo = {
  ...materiale,
  value: JSON.stringify(["Bronzo"]),
};

test("writes missing facet metafields", () => {
  assert.deepEqual(
    buildProductFacetSyncPlan({
      currentMetafields: [],
      previousSyncBayFacets: [],
      proposedFacets: [materiale],
    }).writes,
    [
      {
        key: "materiale",
        namespace: "syncbay_facets",
        type: "list.single_line_text_field",
        value: JSON.stringify(["Argento"]),
      },
    ],
  );
});

test("updates facets still aligned to previous SyncBay baseline", () => {
  const plan = buildProductFacetSyncPlan({
    currentMetafields: [
      {
        key: "materiale",
        namespace: "syncbay_facets",
        type: "list.single_line_text_field",
        value: JSON.stringify(["Bronzo"]),
      },
    ],
    previousSyncBayFacets: [materialeBronzo],
    proposedFacets: [materiale],
  });

  assert.equal(plan.conflicts.length, 0);
  assert.deepEqual(plan.writes, [
    {
      key: "materiale",
      namespace: "syncbay_facets",
      type: "list.single_line_text_field",
      value: JSON.stringify(["Argento"]),
    },
  ]);
});

test("does not overwrite Shopify values changed after the SyncBay baseline", () => {
  const plan = buildProductFacetSyncPlan({
    currentMetafields: [
      {
        key: "materiale",
        namespace: "syncbay_facets",
        type: "list.single_line_text_field",
        value: JSON.stringify(["Oro"]),
      },
    ],
    previousSyncBayFacets: [materialeBronzo],
    proposedFacets: [materiale],
  });

  assert.deepEqual(plan.writes, []);
  assert.deepEqual(plan.conflicts, [
    {
      key: "materiale",
      namespace: "syncbay_facets",
      type: "list.single_line_text_field",
      value: JSON.stringify(["Argento"]),
    },
  ]);
  assert.deepEqual(plan.skipped, [
    { key: "materiale", reason: "manual_conflict" },
  ]);
});

test("deletes facets still aligned to SyncBay when evidence disappears", () => {
  const plan = buildProductFacetSyncPlan({
    currentMetafields: [
      {
        key: "materiale",
        namespace: "syncbay_facets",
        type: "list.single_line_text_field",
        value: JSON.stringify(["Bronzo"]),
      },
    ],
    previousSyncBayFacets: [materialeBronzo],
    proposedFacets: [],
  });

  assert.deepEqual(plan.writes, []);
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.deletes, [
    {
      key: "materiale",
      namespace: "syncbay_facets",
    },
  ]);
  assert.deepEqual(plan.skipped, [
    { key: "materiale", reason: "evidence_missing" },
  ]);
});
```

- [ ] **Step 3: run test**

Run:

```bash
node --experimental-strip-types --test app/lib/syncbay-product-facet-sync-plan.test.ts
```

Expected: all tests pass.

---

### Task 4: Creare Il Servizio Runtime Shopify

**Files:**
- Create: `app/services/syncbay-product-facets.server.ts`
- Test indirectly through Task 5 and Task 6 runner tests.

- [ ] **Step 1: crea servizio**

Create `app/services/syncbay-product-facets.server.ts`:

```ts
import type { ShopifyAdminGraphqlClient } from "../lib/syncbay-shopify-admin";
import {
  buildProductFacetSyncPlan,
  type CurrentProductFacetMetafield,
} from "../lib/syncbay-product-facet-sync-plan";
import type { SyncBayProductFacet } from "../lib/syncbay-product-facets";

const FACET_NAMESPACE = "syncbay_facets";

interface ShopifyMetafieldsResponse {
  data?: {
    product?: {
      metafields?: {
        nodes?: CurrentProductFacetMetafield[];
      };
    };
  };
  errors?: Array<{ message: string }>;
}

interface ShopifyMetafieldsSetResponse {
  data?: {
    metafieldsSet?: {
      userErrors?: Array<{ field?: string[]; message: string }>;
    };
  };
  errors?: Array<{ message: string }>;
}

interface ShopifyMetafieldsDeleteResponse {
  data?: {
    metafieldsDelete?: {
      userErrors?: Array<{ field?: string[]; message: string }>;
    };
  };
  errors?: Array<{ message: string }>;
}

export async function syncShopifyProductFacets(input: {
  admin: ShopifyAdminGraphqlClient;
  ownerId: string;
  previousSyncBayFacets: SyncBayProductFacet[];
  proposedFacets: SyncBayProductFacet[];
}) {
  const currentMetafields = await loadCurrentFacetMetafields(
    input.admin,
    input.ownerId,
  );
  const plan = buildProductFacetSyncPlan({
    currentMetafields,
    previousSyncBayFacets: input.previousSyncBayFacets,
    proposedFacets: input.proposedFacets,
  });

  if (plan.writes.length === 0 && plan.deletes.length === 0) {
    return {
      conflicts: plan.conflicts,
      deleted: [],
      skipped: plan.skipped,
      status: "synced" as const,
      written: [],
    };
  }

  if (plan.writes.length > 0) {
    await writeFacetMetafields(input.admin, {
      metafields: plan.writes.map((metafield) => ({
        ...metafield,
        ownerId: input.ownerId,
      })),
    });
  }
  if (plan.deletes.length > 0) {
    await deleteFacetMetafields(input.admin, {
      metafields: plan.deletes.map((metafield) => ({
        ...metafield,
        ownerId: input.ownerId,
      })),
    });
  }

  return {
    conflicts: plan.conflicts,
    deleted: plan.deletes,
    skipped: plan.skipped,
    status: "synced" as const,
    written: plan.writes,
  };
}

async function loadCurrentFacetMetafields(
  admin: ShopifyAdminGraphqlClient,
  productGid: string,
) {
  const response = await admin.graphql(
    `#graphql
    query SyncBayProductFacetMetafields($id: ID!) {
      product(id: $id) {
        metafields(first: 20, namespace: "syncbay_facets") {
          nodes {
            key
            namespace
            type
            value
          }
        }
      }
    }`,
    { variables: { id: productGid } },
  );
  const json = (await response.json()) as ShopifyMetafieldsResponse;
  if (!response.ok) {
    throw new Error(
      `Shopify lettura metafield faccette ha risposto con stato HTTP ${response.status}.`,
    );
  }
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }

  return json.data?.product?.metafields?.nodes ?? [];
}

async function writeFacetMetafields(
  admin: ShopifyAdminGraphqlClient,
  input: {
    metafields: Array<{
      key: string;
      namespace: typeof FACET_NAMESPACE;
      ownerId: string;
      type: string;
      value: string;
    }>;
  },
) {
  const response = await admin.graphql(
    `#graphql
    mutation SyncBayWriteProductFacetMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors {
          field
          message
        }
      }
    }`,
    { variables: { metafields: input.metafields } },
  );
  const json = (await response.json()) as ShopifyMetafieldsSetResponse;
  if (!response.ok) {
    throw new Error(
      `Shopify scrittura metafield faccette ha risposto con stato HTTP ${response.status}.`,
    );
  }
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }

  const userErrors = json.data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(
      userErrors
        .map((error) =>
          error.field?.length
            ? `${error.field.join(".")}: ${error.message}`
            : error.message,
        )
        .join("; "),
    );
  }
}

async function deleteFacetMetafields(
  admin: ShopifyAdminGraphqlClient,
  input: {
    metafields: Array<{
      key: string;
      namespace: string;
      ownerId: string;
    }>;
  },
) {
  const response = await admin.graphql(
    `#graphql
    mutation SyncBayDeleteProductFacetMetafields($metafields: [MetafieldIdentifierInput!]!) {
      metafieldsDelete(metafields: $metafields) {
        userErrors {
          field
          message
        }
      }
    }`,
    { variables: { metafields: input.metafields } },
  );
  const json = (await response.json()) as ShopifyMetafieldsDeleteResponse;
  if (!response.ok) {
    throw new Error(
      `Shopify cancellazione metafield faccette ha risposto con stato HTTP ${response.status}.`,
    );
  }
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }

  const userErrors = json.data?.metafieldsDelete?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(
      userErrors
        .map((error) =>
          error.field?.length
            ? `${error.field.join(".")}: ${error.message}`
            : error.message,
        )
        .join("; "),
    );
  }
}
```

- [ ] **Step 2: typecheck mirato**

Run:

```bash
npm run typecheck
```

Expected: pass. If it fails on unrelated existing worktree changes, record exact failure and do not broaden the patch.

---

### Task 5: Agganciare Import Riusato E Sync Incrementale

**Files:**
- Modify: `app/services/shopify-draft-import.server.ts`
- Modify: `app/services/sync-job-runner.server.ts`
- Modify: `app/lib/syncbay-product-snapshot-payload.ts`

- [ ] **Step 1: estendi input import con baseline facet**

In `app/services/shopify-draft-import.server.ts`, extend `createShopifyDraftProductsIfEnabled` input:

```ts
facetBaselinesByItemId?: Record<string, SyncBayProductFacet[]>;
```

Import the type:

```ts
import type { SyncBayProductFacet } from "../lib/syncbay-product-facets";
```

- [ ] **Step 2: porta baseline nel draft product**

In `buildShopifyDraftProductInputs`, add parameter:

```ts
facetBaselinesByItemId: Record<string, SyncBayProductFacet[]> = {},
```

And add to returned object:

```ts
facetBaseline: facetBaselinesByItemId[item.itemId] ?? [],
productFacets: item.normalized.productFacets,
```

Use the new parameter from the caller:

```ts
const draftProducts = buildShopifyDraftProductInputs(
  input.previewResult,
  importProductStatus,
  pricingRule,
  input.existingCatalogFieldPoliciesByItemId ?? {},
  input.facetBaselinesByItemId ?? {},
);
```

- [ ] **Step 3: sincronizza faccette quando un prodotto viene riusato**

Import service:

```ts
import { syncShopifyProductFacets } from "./syncbay-product-facets.server";
```

After `syncShopifyExistingCatalogTags` succeeds in `updateShopifyProductFromEbay`, call:

```ts
const facetSyncResult = await syncShopifyProductFacets({
  admin,
  ownerId: product.id,
  previousSyncBayFacets: draftProduct.facetBaseline,
  proposedFacets: draftProduct.productFacets,
});
```

If `facetSyncResult.written.length > 0`, add warning:

```ts
`SyncBay ha aggiornato ${facetSyncResult.written.length} metafield faccette.`
```

If `facetSyncResult.conflicts.length > 0`, add warning:

```ts
`SyncBay non ha sovrascritto ${facetSyncResult.conflicts.length} faccette modificate su Shopify.`
```

Implementation note: `updateShopifyProductFromEbay` currently receives only `draftProduct`, not `item`; Step 2 stores the already-normalized `productFacets` directly on the draft object so this path does not depend on a variable outside scope.

- [ ] **Step 4: passa baseline dal runner**

In `app/services/sync-job-runner.server.ts`, import:

```ts
import type { SyncBayProductFacet } from "../lib/syncbay-product-facets";
import { getProductFacetsFromSnapshotPayload } from "../lib/syncbay-product-snapshot-payload";
```

Before calling `createShopifyDraftProductsIfEnabled` inside the full
`runIncrementalSyncJob` path, load the latest facet baseline-bearing snapshots
for `syncableItemIds`. Do not treat every `SYNCBAY` snapshot as a baseline:
pricing/import metadata snapshots often do not contain `productFacets`.

```ts
const facetBaselinesByItemId = await getLatestFacetBaselinesByItemId({
  ebayItemIds: syncableItemIds,
  shopId: job.shopId,
});
```

Pass:

```ts
facetBaselinesByItemId,
```

Add helper:

```ts
async function getLatestFacetBaselinesByItemId(input: {
  ebayItemIds: string[];
  shopId: string;
}) {
  if (input.ebayItemIds.length === 0) return {};

  const rows = await prisma.productSnapshot.findMany({
    orderBy: { capturedAt: "desc" },
    select: { ebayItemId: true, payload: true, source: true },
    where: {
      ebayItemId: { in: input.ebayItemIds },
      shopId: input.shopId,
      source: {
        in: [
          ProductSnapshotSource.SYNCBAY,
          ProductSnapshotSource.EBAY,
        ],
      },
    },
  });
  const candidates: Record<
    string,
    {
      ebay?: SyncBayProductFacet[];
      syncbay?: SyncBayProductFacet[];
    }
  > = {};

  for (const row of rows) {
    if (!row.ebayItemId) continue;
    const facets = getProductFacetsFromSnapshotPayload(row.payload);
    if (facets.length === 0) continue;
    const candidate = candidates[row.ebayItemId] ?? {};

    if (row.source === ProductSnapshotSource.SYNCBAY && !candidate.syncbay) {
      candidate.syncbay = facets;
    }
    if (row.source === ProductSnapshotSource.EBAY && !candidate.ebay) {
      candidate.ebay = facets;
    }

    candidates[row.ebayItemId] = candidate;
  }

  return Object.fromEntries(
    Object.entries(candidates).flatMap(([ebayItemId, candidate]) => {
      const facets = candidate.syncbay ?? candidate.ebay;
      return facets ? [[ebayItemId, facets]] : [];
    }),
  );
}
```

The helper intentionally prefers the latest `SYNCBAY` snapshot with
`productFacets`, because that is the last writer-owned baseline. It falls back
to the latest `EBAY` snapshot with `productFacets` only for products that have
not received a writer-owned facet snapshot yet.

- [ ] **Step 5: salva le faccette scritte nello snapshot diagnostico**

Keep `buildEbayProductSnapshotPayload` focused on high-confidence source facets
in this PR, but do not rely on arbitrary `SYNCBAY` snapshots as writer guard
baselines. When `syncShopifyProductFacets` writes or deletes facets, persist the
resulting writer-facing facet state in the new `SYNCBAY` snapshot payload.
The existing `EBAY` `productFacets` field remains a source/proposal fallback and
an import-era baseline until the first writer-owned `SYNCBAY` baseline exists.
Do not store medium/low suggestions yet; they are diagnostic material for a
later UI decision, not storefront data.

Add or update a test in `app/lib/syncbay-product-snapshot-payload.test.ts` so the payload round-trip proves that `productFacets` still contains only writer-facing facets:

```ts
test("stores only writer-facing high-confidence product facets in snapshot payloads", () => {
  const payload = buildEbayProductSnapshotPayload({
    descriptionMode: "clean_html",
    issueCodes: [],
    productFacets: [
      {
        key: "materiale",
        label: "Materiale",
        namespace: "syncbay_facets",
        type: "list.single_line_text_field",
        value: JSON.stringify(["Argento"]),
      },
    ],
    skuGenerated: false,
    status: "importable",
  });

  assert.deepEqual(getProductFacetsFromSnapshotPayload(payload), [
    {
      key: "materiale",
      label: "Materiale",
      namespace: "syncbay_facets",
      type: "list.single_line_text_field",
      value: JSON.stringify(["Argento"]),
    },
  ]);
});
```

- [ ] **Step 6: run test mirati**

Run:

```bash
node --experimental-strip-types --test app/lib/syncbay-product-facets.test.ts app/lib/syncbay-product-facet-sync-plan.test.ts app/lib/syncbay-product-snapshot-payload.test.ts
npm run typecheck
```

Expected: pass.

---

### Task 6: Backfill Automatico Con `SYNC_INCREMENTAL` `facetOnly`

**Files:**
- Modify: `app/services/sync-job-runner.server.ts`
- Modify: `app/lib/syncbay-job-diagnostics.ts`
- Modify: `app/lib/syncbay-ui-state.ts` only if visible labels need a clearer distinction.

- [ ] **Step 1: aggiungi detector payload facetOnly**

In `app/services/sync-job-runner.server.ts`, add:

```ts
function isFacetOnlySyncJobPayload(payload: Prisma.JsonValue | null) {
  return getBooleanFromPayload(payload, "facetOnly");
}
```

- [ ] **Step 2: dirama prima del percorso full product update**

Inside `runIncrementalSyncJob`, after conflict filtering and before `isPricingOnlySyncJobPayload`, add:

```ts
if (isFacetOnlySyncJobPayload(job.payload)) {
  return runFacetOnlyIncrementalSyncJob({
    alignedDescriptionConflictResolvedCount: alignedDescriptionConflicts.count,
    alignedPriceConflictResolvedCount: alignedPriceConflicts.count,
    job,
    openConflictSkippedCount: openConflictItemIds.size,
    reactivationConflictResolvedCount,
    requestedItemIds: ebayItemIds,
    syncableItemIds,
  });
}
```

- [ ] **Step 3: implementa `runFacetOnlyIncrementalSyncJob` senza provider eBay**

Use latest `EBAY` snapshots for source signals and load facet writer baselines
separately. Do not mix `EBAY` and `SYNCBAY` rows in one "latest snapshot" map,
because newer `SYNCBAY` pricing/metadata snapshots can lack category fields and
`productFacets`.

```ts
async function runFacetOnlyIncrementalSyncJob(input: {
  alignedDescriptionConflictResolvedCount: number;
  alignedPriceConflictResolvedCount: number;
  job: DueSyncJob;
  openConflictSkippedCount: number;
  reactivationConflictResolvedCount: number;
  requestedItemIds: string[];
  syncableItemIds: string[];
}) {
  const [
    admin,
    mappings,
    ebaySnapshots,
    facetBaselinesByItemId,
  ] = await Promise.all([
    getShopifyAdminGraphqlClient(input.job.shop.shopDomain),
    prisma.productMapping.findMany({
      select: {
        ebayItemId: true,
        id: true,
        shopifyProductGid: true,
      },
      where: {
        ebayItemId: { in: input.syncableItemIds },
        marketplaceId: getEbayMarketplaceId(input.job.payload),
        shopId: input.job.shopId,
        status: ProductMappingStatus.ACTIVE,
      },
    }),
    prisma.productSnapshot.findMany({
      orderBy: { capturedAt: "desc" },
      select: {
        ebayItemId: true,
        payload: true,
        title: true,
      },
      where: {
        ebayItemId: { in: input.syncableItemIds },
        shopId: input.job.shopId,
        source: ProductSnapshotSource.EBAY,
      },
    }),
    getLatestFacetBaselinesByItemId({
      ebayItemIds: input.syncableItemIds,
      shopId: input.job.shopId,
    }),
  ]);

  const latestEbaySnapshotByItemId = new Map<
    string,
    { payload: Prisma.JsonValue | null; title: string | null }
  >();
  for (const snapshot of ebaySnapshots) {
    if (
      !snapshot.ebayItemId ||
      latestEbaySnapshotByItemId.has(snapshot.ebayItemId)
    ) {
      continue;
    }
    latestEbaySnapshotByItemId.set(snapshot.ebayItemId, {
      payload: snapshot.payload,
      title: snapshot.title,
    });
  }

  let facetConflictCount = 0;
  let facetSkippedCount = 0;
  let facetWrittenCount = 0;
  let syncedCount = 0;
  const skipped: Prisma.JsonObject[] = [];

  for (const mapping of mappings) {
    if (!mapping.shopifyProductGid) {
      skipped.push({
        ebayItemId: mapping.ebayItemId,
        reason: "shopify_product_gid_missing",
      });
      continue;
    }

    const ebaySnapshot = latestEbaySnapshotByItemId.get(mapping.ebayItemId);
    if (!ebaySnapshot) {
      skipped.push({
        ebayItemId: mapping.ebayItemId,
        reason: "ebay_snapshot_missing",
      });
      continue;
    }

    const payload = getJsonObject(ebaySnapshot.payload);
    const proposedFacets = buildSyncBayProductFacets({
      ebayPrimaryCategoryName: getNullableStringFromRecord(
        payload,
        "ebayPrimaryCategoryName",
      ),
      itemSpecifics: [],
      storeCategoryName: getNullableStringFromRecord(payload, "storeCategoryName"),
      title: ebaySnapshot.title,
    });
    const previousSyncBayFacets =
      facetBaselinesByItemId[mapping.ebayItemId] ?? [];

    if (proposedFacets.length === 0 && previousSyncBayFacets.length === 0) {
      skipped.push({
        ebayItemId: mapping.ebayItemId,
        reason: "no_high_confidence_facets",
      });
      continue;
    }

    const facetResult = await syncShopifyProductFacets({
      admin,
      ownerId: mapping.shopifyProductGid,
      previousSyncBayFacets,
      proposedFacets,
    });

    facetConflictCount += facetResult.conflicts.length;
    facetSkippedCount += facetResult.skipped.length;
    facetWrittenCount += facetResult.written.length;
    syncedCount += 1;
  }

  await markJobSucceeded({
    delegatedJobId: null,
    job: input.job,
    result: {
      alignedDescriptionConflictResolvedCount:
        input.alignedDescriptionConflictResolvedCount,
      alignedPriceConflictResolvedCount: input.alignedPriceConflictResolvedCount,
      conflictSkippedCount: input.openConflictSkippedCount,
      facetConflictCount,
      facetOnly: true,
      facetSkippedCount,
      facetWrittenCount,
      reactivationConflictResolvedCount: input.reactivationConflictResolvedCount,
      requestedCount: input.requestedItemIds.length,
      skipped,
      syncedCount,
    } satisfies Prisma.JsonObject,
  });

  return {
    jobId: input.job.id,
    status: "succeeded" as const,
    type: input.job.type,
  };
}

function getNullableStringFromRecord(
  value: Record<string, unknown> | null,
  key: string,
) {
  const entry = value?.[key];
  return typeof entry === "string" && entry.trim() ? entry.trim() : null;
}
```

- [ ] **Step 4: pianifica backfill una tantum**

In `enqueueIncrementalSyncJobs`, before seller-events/full-reconcile enqueue, call:

```ts
const facetBackfillQueued = await enqueueFacetBackfillJobsIfNeeded({
  now,
  shopId: shop.id,
});
if (facetBackfillQueued) continue;
```

Add helper:

```ts
async function enqueueFacetBackfillJobsIfNeeded(input: {
  now: Date;
  shopId: string;
}) {
  const version = 1;
  const runId = `${input.shopId}:${DEFAULT_MARKETPLACE_ID}:v${version}`;
  const completedMarker = await prisma.syncJob.findFirst({
    select: { id: true },
    where: {
      AND: [
        { payload: { path: ["source"], equals: "facet_backfill_marker" } },
        { payload: { path: ["facetBackfillRunId"], equals: runId } },
      ],
      shopId: input.shopId,
      status: SyncJobStatus.SUCCEEDED,
      type: SyncJobType.SYNC_INCREMENTAL,
    },
  });
  if (completedMarker) return false;

  const mappings = await prisma.productMapping.findMany({
    orderBy: { updatedAt: "asc" },
    select: { ebayItemId: true },
    take: 2000,
    where: {
      marketplaceId: DEFAULT_MARKETPLACE_ID,
      shopId: input.shopId,
      shopifyProductGid: { not: null },
      status: ProductMappingStatus.ACTIVE,
    },
  });
  if (mappings.length === 0) return false;

  const batches = chunkArray(
    mappings.map((mapping) => mapping.ebayItemId),
    INCREMENTAL_SYNC_BATCH_SIZE,
  );
  const result = await prisma.syncJob.createMany({
    data: batches.map((ebayItemIds, index) => ({
      idempotencyKey: `facet-backfill:${runId}:${index + 1}`,
      maxAttempts: INCREMENTAL_SYNC_MAX_ATTEMPTS,
      payload: {
        batchCount: batches.length,
        batchIndex: index + 1,
        ebayItemIds,
        facetBackfillRunId: runId,
        facetBackfillVersion: version,
        facetOnly: true,
        marketplaceId: DEFAULT_MARKETPLACE_ID,
        source: "facet_backfill",
      } satisfies Prisma.JsonObject,
      runAfter: input.now,
      shopId: input.shopId,
      status: SyncJobStatus.PENDING,
      type: SyncJobType.SYNC_INCREMENTAL,
    })),
    skipDuplicates: true,
  });

  return result.count > 0;
}
```

- [ ] **Step 5: marca completamento reale del backfill**

After the `markJobSucceeded` call in `runFacetOnlyIncrementalSyncJob`, call:

```ts
await maybeMarkFacetBackfillRunSucceeded(input.job);
```

Add this helper near `maybeMarkCatalogReconcileRunWatermarkSucceeded`:

```ts
async function maybeMarkFacetBackfillRunSucceeded(job: DueSyncJob) {
  const source = getStringFromPayload(job.payload, "source");
  const runId = getStringFromPayload(job.payload, "facetBackfillRunId");
  const marketplaceId = getEbayMarketplaceId(job.payload);
  const payloadObject = getJsonObject(job.payload);
  const version = getJsonNumber(payloadObject?.facetBackfillVersion);

  if (source !== "facet_backfill" || !runId || version === null) return;

  const runJobs = await prisma.syncJob.findMany({
    select: { status: true },
    where: {
      AND: [
        { payload: { path: ["source"], equals: "facet_backfill" } },
        { payload: { path: ["facetBackfillRunId"], equals: runId } },
      ],
      shopId: job.shopId,
      type: SyncJobType.SYNC_INCREMENTAL,
    },
  });

  if (
    runJobs.length === 0 ||
    runJobs.some((runJob) => runJob.status !== SyncJobStatus.SUCCEEDED)
  ) {
    return;
  }

  const finishedAt = new Date();
  const markerPayload = {
    facetBackfillRunId: runId,
    facetBackfillVersion: version,
    marketplaceId,
    processedJobCount: runJobs.length,
    source: "facet_backfill_marker",
  } satisfies Prisma.JsonObject;

  await prisma.syncJob.createMany({
    data: [
      {
        attempts: 1,
        finishedAt,
        idempotencyKey: `facet-backfill-marker:${job.shopId}:${marketplaceId}:v${version}:${runId}`,
        maxAttempts: 1,
        payload: markerPayload,
        result: markerPayload,
        runAfter: finishedAt,
        shopId: job.shopId,
        status: SyncJobStatus.SUCCEEDED,
        type: SyncJobType.SYNC_INCREMENTAL,
      },
    ],
    skipDuplicates: true,
  });
}
```

- [ ] **Step 6: aggiorna diagnostica job**

In `app/lib/syncbay-job-diagnostics.ts`, when `payload.source === "facet_backfill"` and `facetOnly === true`, display this as automatic facet backfill and not as ordinary price/catalog sync.

- [ ] **Step 7: run gate standard**

Run:

```bash
npm run test:lib
npm run typecheck
npm run lint
```

Expected: pass. If `lint` or `typecheck` fail on unrelated dirty files, capture exact failures and isolate this branch.

---

### Task 7: Verifica Finale E Pubblicazione

**Files:**
- Modify if needed: `CHANGELOG.md`
- Modify if needed: `app/lib/version.ts` through release flow only if `[Non rilasciato]` has versioned runtime changes and maintainer asks to publish.

- [ ] **Step 1: aggiorna changelog**

Add under `[Non rilasciato]` / `Correzioni` or `Sotto il cofano`:

```markdown
- Faccette storefront: SyncBay deduce automaticamente `Categoria`, `Area / Stato`,
  `Materiale`, `Conservazione` e `Perizia` con regole deterministiche ad alta
  confidenza, aggiorna i metafield `syncbay_facets.*` nel runner incrementale e
  usa un backfill automatico `facetOnly` senza affidarsi allo script manuale.
```

- [ ] **Step 2: self-review diff**

Run:

```bash
git diff --check
git diff --stat
git diff -- app/lib app/services docs README.md CHANGELOG.md
```

Expected: diff limited to planned files.

- [ ] **Step 3: verifiche standard**

Run:

```bash
npm run test:lib
npm run typecheck
npm run lint
npm run build
```

Expected: pass.

- [ ] **Step 4: verifica Shopify metafield behavior in dev store**

Only after local tests pass and with a safe dev shop:

```bash
npm run facets:backfill -- --shop syncbay-dev.myshopify.com --limit 5 --json
```

Expected: diagnostic output only. Do not apply with the script as ordinary flow.

Then enqueue or inspect a `facetOnly` job in dev and run the protected runner with the repo's existing safe procedure. Expected result:

```text
facetOnly: true
facetWrittenCount: >= 0
facetConflictCount: >= 0
```

- [ ] **Step 5: release classification**

Classify as `PATCH`: compatible runtime automation/hardening of existing 1.0 faccette.

Run:

```bash
npm run release:dry-run
```

Expected: category patch if changelog contains runtime change.

- [ ] **Step 6: branch, PR e publish**

Use a dedicated branch/worktree because the root checkout is currently dirty:

```bash
git worktree add ../SyncBay-facet-inference -b codex/automatic-facet-inference origin/main
```

After implementation and verification:

```bash
git add app docs README.md CHANGELOG.md
git commit -m "fix: automate SyncBay facet inference"
git push -u origin codex/automatic-facet-inference
```

Create PR with explicit title:

```bash
gh pr create --title "fix: automate SyncBay facet inference" --body-file /tmp/syncbay-facet-inference-pr.md
```

Before merge, run the repo preflight and check Codex feedback inbox according to `AGENTS.md`.

---

## Self-Review

Spec coverage:

- Backfill automatico: covered by Task 6 `facetOnly` `SYNC_INCREMENTAL`.
- Runner incrementale: covered by Task 5 full sync path and Task 6 facet-only branch.
- eBay weak source: covered by Task 1 and Task 2 title-first deterministic inference.
- Manual edit protection: covered by Task 3 baseline sync plan and Task 4 service.
- No script manual as ordinary flow: covered by Task 1, Task 6 and Task 7.
- Only five facets: explicitly preserved in Scope and Task 2.

Placeholder scan:

- No open red-flag instructions remain.
- Task 6 includes a concrete `facetOnly` loop shape, counters and skip reasons.

Type consistency:

- `SyncBayProductFacet` and `ShopifyProductFacetMetafield` remain the writer-facing types.
- `SyncBayProductFacetInference` extends the existing facet shape without forcing callers to adopt medium/low suggestions.
- `facetOnly` stays payload-level and does not require a Prisma enum migration.

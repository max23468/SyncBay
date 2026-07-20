# Numisleo Collection Rule Alignment Implementation Plan

**Goal:** mantenere le collezioni Shopify esistenti di Numisleo sempre coerenti con i nuovi prodotti sincronizzati da SyncBay, riadattando le regole automatiche al `productType` SyncBay e correggendo il mapper a monte quando il tipo prodotto è troppo generico o errato.

**Architecture:** la soluzione resta fuori dal runtime merchant-facing: prima un doctor operativo read-only, poi una matrice regole/prodotti, poi apply esplicito su Shopify solo dopo conferma. La logica riutilizzabile vive in moduli puri `app/lib/*`, mentre lo script `scripts/syncbay-collections-doctor.mjs` usa Shopify Admin GraphQL via Shopify CLI locale per audit e, solo con doppi flag, per mutation sulle collezioni. Gli intenti Numisleo restano in un file operativo passato con `--intent-file`, non hardcoded nello script. SyncBay non crea nuove collezioni Numisleo-specifiche e non sostituisce Shopify: rende affidabili `productType`, regole automatiche e verifiche di drift.

**Tech Stack:** Node 24, TypeScript strip-types per test `node --test`, Shopify Admin GraphQL 2026-07, Shopify CLI `shopify store execute`, script operativi npm, documentazione SyncBay/Numisleo.

---

## Scope

Incluso:

- Audit live delle collezioni automatiche esistenti su `numisleo.myshopify.com`.
- Report dei prodotti disponibili presenti solo in collezioni generiche.
- Report dei prodotti esauriti presenti in collezioni specifiche.
- Identificazione di regole collezione fragili, soprattutto senza vincolo inventario.
- Proposte di aggiornamento `ruleSet` sulle collezioni esistenti.
- Correzioni al mapper SyncBay quando produce `productType` troppo generici o incoerenti con la navigazione Numisleo.
- Comando `npm run collections:doctor` in dry-run di default.
- Gate di compatibilità GraphQL prima di ogni mutation, perché Shopify espone il modello nuovo `collection`/`sources` e mantiene `input`/`ruleSet` come legacy.
- Apply Shopify solo con `--apply --confirm-apply`.

Escluso:

- Creare nuove collezioni Shopify.
- Eliminare o rinominare collezioni esistenti.
- Cambiare handle, URL, SEO description, immagini o descrizioni collezione.
- Usare metafield come leva primaria della navigazione collezioni.
- Inserire nel codice SyncBay una configurazione Numisleo hardcoded.
- Introdurre un worker, cron, runtime o app extension.
- Automatizzare apply ricorrente prima di avere report stabile e approvazione.

## Evidence To Preserve

Audit read-only eseguito il 2026-07-05:

- Shopify plugin Codex per collezioni: `403 Forbidden`; fallback usato: Shopify CLI read-only.
- Store: `numisleo.myshopify.com`, dominio primario `https://numisleo.it`.
- Collezioni live: 31.
- `Negozio Online`: `productsCount.count = 965`.
- Scansione prodotti `ACTIVE`: 4.483 prodotti, 883 con `totalInventory > 0`.
- Prodotti disponibili solo in collezione generica: 14.
- Prodotti disponibili anche in `Non disponibili`: 0.
- Prodotti esauriti dentro collezioni specifiche: 5, tutti in `Accessori numismatici`.
- Causa osservata su `Accessori numismatici`: `ruleSet.appliedDisjunctively = true` con sole condizioni `TITLE CONTAINS capsul|masterphil|raccoglitore`, senza `VARIANT_INVENTORY > 0`.
- Vincolo importante: non aggiungere `VARIANT_INVENTORY > 0` a una regola titolo `OR` trasformandola in `AND`; per `Accessori numismatici` serve una decisione esplicita tra mantenere la logica titolo o passare a una regola `TYPE` affidabile.
- Esempio di mapper troppo debole: prodotto Francia `1 Franc` con `productType = Monete italiane`.

Questi numeri vanno ricalcolati all'inizio dell'implementazione: sono evidenza di partenza, non fixture permanente.

## File Structure

Create:

- `app/lib/syncbay-collection-coverage-report.ts`
  Modulo puro per classificare prodotti e collezioni: scoperti, esauriti inclusi, collezioni generiche, collezioni specifiche, regole senza inventario.

- `app/lib/syncbay-collection-coverage-report.test.ts`
  Test unitari del report con fixture sintetiche.

- `app/lib/syncbay-collection-rule-proposals.ts`
  Modulo puro per proporre patch conservative alle regole collezione esistenti e segnalare quelle da revisione manuale.

- `app/lib/syncbay-collection-rule-proposals.test.ts`
  Test su inventario obbligatorio, preservazione collezioni, nessuna proposta distruttiva e blocco delle trasformazioni `OR` titolo in `AND`.

- `app/lib/syncbay-collection-intents.ts`
  Modulo puro per caricare e validare il file operativo degli intenti collezione passato al doctor.

- `app/lib/syncbay-collection-intents.test.ts`
  Test su validazione intenti, collezioni generiche, duplicati handle e assenza di configurazione hardcoded.

- `scripts/syncbay-collections-doctor.mjs`
  Script operativo read-only di default. Legge live Shopify via `shopify store execute`, produce JSON/human report, carica gli intenti da `--intent-file` e può scrivere solo con `--apply --confirm-apply`.

Modify:

- `package.json`
  Aggiunge script `collections:doctor`.

- `app/lib/syncbay-shopify-category-mapping.ts`
  Raffina `productType` per casi reali Numisleo/SyncBay dove il tipo attuale è troppo generico.

- `app/lib/syncbay-shopify-category-mapping.test.ts`
  Aggiunge test regressione su Regno, Repubblica, euro Italia, Vaticano/San Marino, Francia pre-euro, medaglie e divisionali.

- `docs/TOOLCHAIN.md`
  Documenta `npm run collections:doctor`.

- `docs/decisions/0015-mapping-categorie-ebay-shopify.md`
  Aggiorna la decisione solo se il cambio `productType` diventa stabile e non solo operativo Numisleo.

- `CHANGELOG.md`
  Se cambia mapper runtime o script versionato con impatto prodotto, aggiunge voce in `[Non rilasciato]`.

Do not touch:

- Collezioni live Shopify senza un apply esplicito.
- `docs/superpowers/plans/2026-06-21-syncbay-1-0-existing-catalog-takeover.md`, già modificato prima di questo piano.
- `docs/superpowers/plans/2026-07-05-syncbay-automatic-facet-inference.md`, già non tracciato prima di questo piano.

---

## Task 1: Baseline Branch And Live Snapshot

**Files:**

- Read: `AGENTS.md`
- Read: `.mex/ROUTER.md`
- Read: `docs/CONTEXT.md`
- Read: `docs/TOOLCHAIN.md`
- Read: `docs/decisions/0015-mapping-categorie-ebay-shopify.md`
- Read: `docs/decisions/0016-faccette-storefront-import.md`
- Output local only: `audits/collections-rule-alignment-YYYY-MM-DD/`

- [ ] **Step 1: Check status and protect existing changes**

Run:

```bash
git status --short
```

Expected: existing unrelated changes are noted and not staged. If the checkout still contains unrelated changes in `docs/superpowers/plans/2026-06-21-syncbay-1-0-existing-catalog-takeover.md` or an untracked facet plan, leave them untouched.

- [ ] **Step 2: Create an isolated branch or worktree before implementation**

If the main checkout is dirty, prefer a worktree:

```bash
git fetch origin main
git worktree add ../SyncBay-collection-rules -b codex/numisleo-collection-rules origin/main
cd ../SyncBay-collection-rules
```

If the maintainer explicitly wants the current checkout, use a branch only when no touched files overlap:

```bash
git switch -c codex/numisleo-collection-rules
```

Expected: branch name starts with `codex/`, and unrelated local changes remain outside the implementation branch/worktree.

- [ ] **Step 3: Capture live Shopify collections read-only**

Run:

```bash
mkdir -p audits/collections-rule-alignment-$(date +%F)
shopify store execute \
  --store numisleo.myshopify.com \
  --version 2026-07 \
  --json \
  --query 'query SyncBayCollectionRulesSnapshot { shop { name myshopifyDomain primaryDomain { url } } collections(first: 100, sortKey: TITLE) { nodes { id title handle updatedAt sortOrder productsCount { count } ruleSet { appliedDisjunctively rules { column relation condition } } } pageInfo { hasNextPage endCursor } } }' \
  --output-file audits/collections-rule-alignment-$(date +%F)/collections.json
```

Expected: JSON file is written under `audits/`; no mutation flags are used.

- [ ] **Step 4: Capture live products read-only**

Run this temporary local script from the repo root:

```bash
node <<'NODE'
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const outDir = `audits/collections-rule-alignment-${new Date().toISOString().slice(0, 10)}`;
fs.mkdirSync(outDir, { recursive: true });
const query = `query SyncBayProductsForCollectionRules($after: String) {
  products(first: 250, after: $after, query: "status:active", sortKey: ID) {
    nodes {
      id
      title
      handle
      status
      productType
      totalInventory
      collections(first: 50) { nodes { id title handle } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
let after = null;
const products = [];
while (true) {
  const output = execFileSync("shopify", [
    "store", "execute",
    "--store", "numisleo.myshopify.com",
    "--version", "2026-07",
    "--json",
    "--query", query,
    "--variables", JSON.stringify({ after }),
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const parsed = JSON.parse(output.slice(output.indexOf("{")));
  products.push(...(parsed.products?.nodes ?? []));
  const pageInfo = parsed.products?.pageInfo;
  if (!pageInfo?.hasNextPage) break;
  after = pageInfo.endCursor;
}
fs.writeFileSync(`${outDir}/products.json`, JSON.stringify({ products }, null, 2));
console.log(`Wrote ${products.length} products to ${outDir}/products.json`);
NODE
```

Expected: local JSON snapshot exists and remains untracked because `audits/` is
ignored by `.gitignore`.

---

## Task 2: Pure Collection Coverage Report

**Files:**

- Create: `app/lib/syncbay-collection-coverage-report.ts`
- Create: `app/lib/syncbay-collection-coverage-report.test.ts`

- [ ] **Step 1: Write failing tests**

Create `app/lib/syncbay-collection-coverage-report.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildCollectionCoverageReport } from "./syncbay-collection-coverage-report.ts";

const genericHandles = ["negozio-online", "non-disponibili"];

test("flags available products that only belong to generic collections", () => {
  const report = buildCollectionCoverageReport({
    genericCollectionHandles: genericHandles,
    products: [
      {
        collections: [{ handle: "negozio-online", title: "Negozio Online" }],
        handle: "syncbay-ebay-1",
        id: "gid://shopify/Product/1",
        productType: "Monete italiane",
        title: "NL* VEIII 1 CENTESIMO 1905",
        totalInventory: 1,
      },
    ],
  });

  assert.equal(report.summary.availableOnlyGeneric, 1);
  assert.deepEqual(
    report.availableOnlyGeneric.map((row) => row.handle),
    ["syncbay-ebay-1"],
  );
});

test("flags unavailable products that remain in specific collections", () => {
  const report = buildCollectionCoverageReport({
    genericCollectionHandles: genericHandles,
    products: [
      {
        collections: [
          { handle: "non-disponibili", title: "Non disponibili" },
          { handle: "accessori-numismatici", title: "Accessori numismatici" },
        ],
        handle: "album-masterphil",
        id: "gid://shopify/Product/2",
        productType: "Monete e banconote:Cataloghi e accessori",
        title: "NL* ALBUM MONETE MASTERPHIL",
        totalInventory: 0,
      },
    ],
  });

  assert.equal(report.summary.unavailableInSpecific, 1);
  assert.deepEqual(report.unavailableInSpecific[0]?.specificCollections, ["Accessori numismatici"]);
});

test("keeps available products in specific collections out of problem lists", () => {
  const report = buildCollectionCoverageReport({
    genericCollectionHandles: genericHandles,
    products: [
      {
        collections: [
          { handle: "negozio-online", title: "Negozio Online" },
          { handle: "banconote", title: "Banconote" },
        ],
        handle: "banconota-1",
        id: "gid://shopify/Product/3",
        productType: "Monete e banconote:Banconote",
        title: "NL* Banconota 1000 Lire",
        totalInventory: 2,
      },
    ],
  });

  assert.equal(report.summary.availableOnlyGeneric, 0);
  assert.equal(report.summary.unavailableInSpecific, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test --experimental-strip-types app/lib/syncbay-collection-coverage-report.test.ts
```

Expected: FAIL because `syncbay-collection-coverage-report.ts` does not exist.

- [ ] **Step 3: Implement minimal report module**

Create `app/lib/syncbay-collection-coverage-report.ts`:

```ts
export interface CollectionCoverageCollection {
  handle: string;
  title: string;
}

export interface CollectionCoverageProduct {
  collections: CollectionCoverageCollection[];
  handle: string;
  id: string;
  productType: string | null;
  title: string;
  totalInventory: number | null;
}

export interface CollectionCoverageReportRow {
  collections: string[];
  handle: string;
  id: string;
  productType: string | null;
  specificCollections: string[];
  title: string;
  totalInventory: number;
}

export interface CollectionCoverageReport {
  availableOnlyGeneric: CollectionCoverageReportRow[];
  summary: {
    available: number;
    availableOnlyGeneric: number;
    total: number;
    unavailableInSpecific: number;
  };
  unavailableInSpecific: CollectionCoverageReportRow[];
}

export function buildCollectionCoverageReport(input: {
  genericCollectionHandles: string[];
  products: CollectionCoverageProduct[];
}): CollectionCoverageReport {
  const genericHandles = new Set(input.genericCollectionHandles);
  const rows = input.products.map(toReportRow);
  const availableRows = rows.filter((row) => row.totalInventory > 0);
  const availableOnlyGeneric = availableRows.filter((row) => row.specificCollections.length === 0);
  const unavailableInSpecific = rows.filter(
    (row) => row.totalInventory <= 0 && row.specificCollections.length > 0,
  );

  return {
    availableOnlyGeneric,
    summary: {
      available: availableRows.length,
      availableOnlyGeneric: availableOnlyGeneric.length,
      total: rows.length,
      unavailableInSpecific: unavailableInSpecific.length,
    },
    unavailableInSpecific,
  };

  function toReportRow(product: CollectionCoverageProduct): CollectionCoverageReportRow {
    const collections = product.collections.map((collection) => collection.title);
    const specificCollections = product.collections
      .filter((collection) => !genericHandles.has(collection.handle))
      .map((collection) => collection.title);

    return {
      collections,
      handle: product.handle,
      id: product.id,
      productType: product.productType,
      specificCollections,
      title: product.title,
      totalInventory: Number(product.totalInventory ?? 0),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --test --experimental-strip-types app/lib/syncbay-collection-coverage-report.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit if working in isolated branch**

```bash
git add app/lib/syncbay-collection-coverage-report.ts app/lib/syncbay-collection-coverage-report.test.ts
git commit -m "feat: add collection coverage report"
```

---

## Task 3: Rule Review Engine For Existing Collections

**Files:**

- Create: `app/lib/syncbay-collection-rule-proposals.ts`
- Create: `app/lib/syncbay-collection-rule-proposals.test.ts`

- [ ] **Step 1: Write failing tests for conservative proposals and warnings**

Create `app/lib/syncbay-collection-rule-proposals.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildCollectionRuleReview } from "./syncbay-collection-rule-proposals.ts";

test("warns instead of changing disjunctive title rules without product type intent", () => {
  const review = buildCollectionRuleReview({
    collectionIntents: [
      {
        handle: "accessori-numismatici",
        requirePositiveInventory: true,
        title: "Accessori numismatici",
      },
    ],
    collections: [
      {
        handle: "accessori-numismatici",
        id: "gid://shopify/Collection/1",
        ruleSet: {
          appliedDisjunctively: true,
          rules: [
            { column: "TITLE", relation: "CONTAINS", condition: "capsul" },
            { column: "TITLE", relation: "CONTAINS", condition: "masterphil" },
          ],
        },
        title: "Accessori numismatici",
      },
    ],
  });

  assert.deepEqual(review.proposals, []);
  assert.equal(review.warnings.length, 1);
  assert.equal(review.warnings[0]?.reason, "unsafe_disjunctive_title_rules");
  assert.match(review.warnings[0]?.message ?? "", /OR.*AND/);
});

test("adds inventory guard only to conjunctive specific automatic collections", () => {
  const review = buildCollectionRuleReview({
    collectionIntents: [
      {
        handle: "cataloghi-accessori",
        requirePositiveInventory: true,
        title: "Cataloghi accessori",
      },
    ],
    collections: [
      {
        handle: "cataloghi-accessori",
        id: "gid://shopify/Collection/4",
        ruleSet: {
          appliedDisjunctively: false,
          rules: [
            {
              column: "TYPE",
              relation: "CONTAINS",
              condition: "Cataloghi e accessori",
            },
          ],
        },
        title: "Cataloghi accessori",
      },
    ],
  });

  assert.equal(review.warnings.length, 0);
  assert.equal(review.proposals.length, 1);
  assert.equal(review.proposals[0]?.reason, "missing_inventory_guard");
  assert.deepEqual(review.proposals[0]?.proposedRuleSet, {
    appliedDisjunctively: false,
    rules: [
      {
        column: "TYPE",
        relation: "CONTAINS",
        condition: "Cataloghi e accessori",
      },
      { column: "VARIANT_INVENTORY", relation: "GREATER_THAN", condition: "0" },
    ],
  });
});

test("does not propose changes for generic collections", () => {
  const review = buildCollectionRuleReview({
    collectionIntents: [
      {
        generic: true,
        handle: "negozio-online",
        requirePositiveInventory: true,
        title: "Negozio Online",
      },
    ],
    collections: [
      {
        handle: "negozio-online",
        id: "gid://shopify/Collection/2",
        ruleSet: {
          appliedDisjunctively: false,
          rules: [
            {
              column: "VARIANT_INVENTORY",
              relation: "GREATER_THAN",
              condition: "0",
            },
          ],
        },
        title: "Negozio Online",
      },
    ],
  });

  assert.deepEqual(review.proposals, []);
  assert.deepEqual(review.warnings, []);
});

test("uses product type rules from explicit collection intent", () => {
  const review = buildCollectionRuleReview({
    collectionIntents: [
      {
        handle: "banconote",
        productTypeContains: ["Banconote"],
        requirePositiveInventory: true,
        title: "Banconote",
      },
    ],
    collections: [
      {
        handle: "banconote",
        id: "gid://shopify/Collection/3",
        ruleSet: {
          appliedDisjunctively: false,
          rules: [
            {
              column: "TYPE",
              relation: "CONTAINS",
              condition: "Monete e banconote:Banconote",
            },
            {
              column: "VARIANT_INVENTORY",
              relation: "GREATER_THAN",
              condition: "0",
            },
          ],
        },
        title: "Banconote",
      },
    ],
  });

  assert.equal(review.proposals.length, 1);
  assert.equal(review.proposals[0]?.reason, "configured_product_type_alignment");
  assert.deepEqual(review.proposals[0]?.proposedRuleSet, {
    appliedDisjunctively: false,
    rules: [
      { column: "TYPE", relation: "CONTAINS", condition: "Banconote" },
      { column: "VARIANT_INVENTORY", relation: "GREATER_THAN", condition: "0" },
    ],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test --experimental-strip-types app/lib/syncbay-collection-rule-proposals.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement review module**

Create `app/lib/syncbay-collection-rule-proposals.ts`:

```ts
export interface ShopifyCollectionRule {
  column: string;
  condition: string;
  relation: string;
}

export interface ShopifyCollectionRuleSet {
  appliedDisjunctively: boolean;
  rules: ShopifyCollectionRule[];
}

export interface ShopifyCollectionForRuleProposal {
  handle: string;
  id: string;
  ruleSet: ShopifyCollectionRuleSet | null;
  title: string;
}

export interface CollectionRuleIntent {
  generic?: boolean;
  handle: string;
  productTypeContains?: string[];
  requirePositiveInventory: boolean;
  title: string;
}

export interface CollectionRuleProposal {
  collectionId: string;
  currentRuleSet: ShopifyCollectionRuleSet | null;
  handle: string;
  proposedRuleSet: ShopifyCollectionRuleSet;
  reason: "configured_product_type_alignment" | "missing_inventory_guard";
  title: string;
}

export interface CollectionRuleWarning {
  handle: string;
  message: string;
  reason: "unsafe_disjunctive_title_rules" | "missing_collection_intent";
  title: string;
}

export interface CollectionRuleReview {
  proposals: CollectionRuleProposal[];
  warnings: CollectionRuleWarning[];
}

const INVENTORY_RULE: ShopifyCollectionRule = {
  column: "VARIANT_INVENTORY",
  condition: "0",
  relation: "GREATER_THAN",
};

export function buildCollectionRuleReview(input: {
  collectionIntents: CollectionRuleIntent[];
  collections: ShopifyCollectionForRuleProposal[];
}): CollectionRuleReview {
  const intentByHandle = new Map(input.collectionIntents.map((intent) => [intent.handle, intent]));
  const proposals: CollectionRuleProposal[] = [];
  const warnings: CollectionRuleWarning[] = [];

  for (const collection of input.collections) {
    const intent = intentByHandle.get(collection.handle);
    if (!intent || intent.generic) continue;

    const reviewItem = buildProposedRuleSet(collection, intent);
    if (!reviewItem) continue;
    if ("warning" in reviewItem) {
      warnings.push(reviewItem.warning);
      continue;
    }

    if (areRuleSetsEqual(collection.ruleSet, reviewItem.ruleSet)) {
      continue;
    }

    proposals.push({
      collectionId: collection.id,
      currentRuleSet: collection.ruleSet,
      handle: collection.handle,
      proposedRuleSet: reviewItem.ruleSet,
      reason: reviewItem.reason,
      title: collection.title,
    });
  }

  return { proposals, warnings };
}

function buildProposedRuleSet(
  collection: ShopifyCollectionForRuleProposal,
  intent: CollectionRuleIntent,
):
  | {
      reason: CollectionRuleProposal["reason"];
      ruleSet: ShopifyCollectionRuleSet;
    }
  | { warning: CollectionRuleWarning }
  | null {
  const productTypeRules = (intent.productTypeContains ?? []).map((condition) => ({
    column: "TYPE",
    condition,
    relation: "CONTAINS",
  }));

  if (productTypeRules.length > 0) {
    return {
      reason: "configured_product_type_alignment",
      ruleSet: {
        appliedDisjunctively: false,
        rules: [...productTypeRules, ...(intent.requirePositiveInventory ? [INVENTORY_RULE] : [])],
      },
    };
  }

  if (isUnsafeDisjunctiveRuleSet(collection.ruleSet)) {
    return {
      warning: {
        handle: collection.handle,
        message:
          "Regola titolo OR non modificata automaticamente: aggiungere inventario la trasformerebbe in AND. Decidere un productType affidabile o usare modello Shopify sources se serve mantenere gruppi OR.",
        reason: "unsafe_disjunctive_title_rules",
        title: collection.title,
      },
    };
  }

  if (
    intent.requirePositiveInventory &&
    collection.ruleSet &&
    !hasInventoryRule(collection.ruleSet)
  ) {
    return {
      reason: "missing_inventory_guard",
      ruleSet: {
        appliedDisjunctively: false,
        rules: [...collection.ruleSet.rules, INVENTORY_RULE],
      },
    };
  }

  return null;
}

function isUnsafeDisjunctiveRuleSet(ruleSet: ShopifyCollectionRuleSet | null) {
  return Boolean(
    ruleSet?.appliedDisjunctively &&
    ruleSet.rules.filter((rule) => !isInventoryRule(rule)).length > 1,
  );
}

function hasInventoryRule(ruleSet: ShopifyCollectionRuleSet) {
  return ruleSet.rules.some((rule) => isInventoryRule(rule));
}

function isInventoryRule(rule: ShopifyCollectionRule) {
  return (
    rule.column === INVENTORY_RULE.column &&
    rule.relation === INVENTORY_RULE.relation &&
    rule.condition === INVENTORY_RULE.condition
  );
}

function areRuleSetsEqual(left: ShopifyCollectionRuleSet | null, right: ShopifyCollectionRuleSet) {
  if (!left) return false;
  return JSON.stringify(normalizeRuleSet(left)) === JSON.stringify(normalizeRuleSet(right));
}

function normalizeRuleSet(ruleSet: ShopifyCollectionRuleSet) {
  return {
    appliedDisjunctively: ruleSet.appliedDisjunctively,
    rules: [...ruleSet.rules].sort((left, right) =>
      `${left.column}:${left.relation}:${left.condition}`.localeCompare(
        `${right.column}:${right.relation}:${right.condition}`,
      ),
    ),
  };
}
```

- [ ] **Step 4: Run proposal tests**

Run:

```bash
node --test --experimental-strip-types app/lib/syncbay-collection-rule-proposals.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/syncbay-collection-rule-proposals.ts app/lib/syncbay-collection-rule-proposals.test.ts
git commit -m "feat: propose collection rule updates"
```

---

## Task 4: ProductType Mapper Corrections

**Files:**

- Modify: `app/lib/syncbay-shopify-category-mapping.test.ts`
- Modify: `app/lib/syncbay-shopify-category-mapping.ts`
- Possibly modify: `docs/decisions/0015-mapping-categorie-ebay-shopify.md`

- [ ] **Step 1: Add failing tests for collection-grade product types**

First update the existing test
`keeps commemorative details in productType without using a narrow Shopify
category` so it still covers the generic commemorative fallback without using an
input that now has a collection-grade product type. Do not keep
`Monete e banconote:Monete in euro:Italia` plus
`Italia 2 Euro commemorativo FDC 2024` expecting `Monete commemorative`; that
case is now covered by the new Euro Italia assertion below and should expect
`Monete in euro:Italia`.

Use a fallback-only input such as:

```ts
resolveShopifyCategoryProposal({
  ebayPrimaryCategoryName: "Monete e banconote:Monete",
  title: "Moneta commemorativa Expo 2015 FDC",
});
```

Expected: the existing test still asserts `productType: "Monete commemorative"`
and `shopifyCategoryName: "Collectible Coins"` with the same full `deepEqual`
shape as today: `confidence: "medium"` and `source: "title"`. Do not use
`Monete e banconote:Monete commemorative` as the primary category for this
replacement fixture, because that should resolve from the eBay primary category
with `confidence: "high"` and would require a different assertion.

Append these tests to `app/lib/syncbay-shopify-category-mapping.test.ts`:

```ts
test("maps French pre-euro coins away from Italian product type", () => {
  assert.equal(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName: "Monete e banconote:Monete europee pre euro:Francia",
      title: "NL* FRANCIA REPUBBLICA NAPOLEONE I Imperatore 1 Franc ARGENTO AN 13 A",
    }).productType,
    "Monete europee pre euro:Francia",
  );
});

test("maps Regno d'Italia lire to collection-grade product type", () => {
  assert.equal(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName: "Monete e banconote:Monete italiane in lire:Regno:Dal 1901 al 1945",
      title: "NL* VEIII 1 CENTESIMO 1905 VARIANTE 5 SPOSTATO NC QFDC",
    }).productType,
    "Monete italiane in lire:Regno",
  );
});

test("maps Repubblica lire to collection-grade product type", () => {
  assert.equal(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName:
        "Monete e banconote:Monete italiane in lire:Repubblica:Dal 1981 al 2001",
      title: "NL* ITALIA Divisionale 1993 GOLDONI 11 V con 500 Lire ARGENTO FDC",
    }).productType,
    "Monete italiane in lire:Repubblica",
  );
});

test("maps euro Italy to collection-grade product type", () => {
  assert.equal(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName: "Monete e banconote:Monete in euro:Italia",
      title: "Italia 2 Euro commemorativo FDC 2024",
    }).productType,
    "Monete in euro:Italia",
  );
});

test("keeps medals usable by existing medal collections", () => {
  assert.equal(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName: "Monete e banconote:Medaglie",
      title: "NL* FRANCIA PARIGI MEDAGLIA Camera di Commercio PARIGI LABAYE",
    }).productType,
    "Medaglie",
  );
});
```

- [ ] **Step 2: Run mapper tests to verify failure**

Run:

```bash
node --test --experimental-strip-types app/lib/syncbay-shopify-category-mapping.test.ts
```

Expected: FAIL on at least the French and Italian subcategory productType assertions.

- [ ] **Step 3: Implement minimal mapper changes**

Modify `app/lib/syncbay-shopify-category-mapping.ts` so the coin branches choose a collection-grade product type before returning generic `Monete italiane`.

Use a helper with deterministic order:

```ts
function getCollectionGradeCoinProductType(input: {
  primaryText: string;
  storeText: string;
  titleText: string;
}): string | null {
  const text = [input.primaryText, input.storeText, input.titleText].join(" ");

  if (text.includes("monete italiane in lire") && text.includes("regno")) {
    return "Monete italiane in lire:Regno";
  }
  if (text.includes("monete italiane in lire") && text.includes("repubblica")) {
    return "Monete italiane in lire:Repubblica";
  }
  if (text.includes("monete in euro") && text.includes("italia")) {
    return "Monete in euro:Italia";
  }
  if (text.includes("monete in euro") && text.includes("vaticano")) {
    return "Monete in euro:Vaticano";
  }
  if (text.includes("monete in euro") && text.includes("san marino")) {
    return "Monete in euro:San Marino";
  }
  if (text.includes("monete europee pre euro") && text.includes("francia")) {
    return "Monete europee pre euro:Francia";
  }
  if (text.includes("monete europee pre euro")) {
    return "Monete europee pre euro";
  }

  return null;
}
```

Then replace the current commemorative/rare/generic coin branch order with a
single ordered block that applies the collection-grade refinement before the
generic commemorative fallback:

```ts
const collectionGradeCoinType = getCollectionGradeCoinProductType({
  primaryText,
  storeText,
  titleText,
});

const commemorativeCoinsSignal = findMatchingSignal(signals, matchesCommemorativeCoins);
const rareCoinsSignal = findMatchingSignal(signals, matchesRareCoins);
const coinsSignal = findMatchingSignal(signals, matchesCoins);
const collectionGradeCoinSignal = rareCoinsSignal ?? coinsSignal ?? commemorativeCoinsSignal;

if (collectionGradeCoinType && collectionGradeCoinSignal) {
  return buildProposal({
    category: SHOPIFY_TAXONOMY_CATEGORIES.collectibleCoins,
    confidence: collectionGradeCoinSignal.confidence,
    productType: collectionGradeCoinType,
    source: collectionGradeCoinSignal.source,
  });
}

if (commemorativeCoinsSignal) {
  return buildProposal({
    category: SHOPIFY_TAXONOMY_CATEGORIES.collectibleCoins,
    confidence: commemorativeCoinsSignal.confidence,
    productType: "Monete commemorative",
    source: commemorativeCoinsSignal.source,
  });
}

if (rareCoinsSignal) {
  return buildProposal({
    category: SHOPIFY_TAXONOMY_CATEGORIES.collectibleCoins,
    confidence: rareCoinsSignal.confidence,
    productType: "Monete italiane",
    source: rareCoinsSignal.source,
  });
}

if (coinsSignal) {
  return buildProposal({
    category: SHOPIFY_TAXONOMY_CATEGORIES.collectibleCoins,
    confidence: coinsSignal.confidence,
    productType: "Monete italiane",
    source: coinsSignal.source,
  });
}
```

Do not change Shopify taxonomy category unless an existing test requires it.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
node --test --experimental-strip-types app/lib/syncbay-shopify-category-mapping.test.ts
```

Expected: PASS.

- [ ] **Step 5: Decide whether ADR update is required**

If the new productType values are accepted as stable SyncBay behavior, update `docs/decisions/0015-mapping-categorie-ebay-shopify.md` with:

```markdown
Aggiornamento 2026-07-05: per mantenere le collezioni automatiche Shopify più stabili nella 1.0 privata, SyncBay può usare `productType` più specifici quando la categoria eBay fornisce un sotto-percorso affidabile, per esempio `Monete italiane in lire:Regno`, `Monete italiane in lire:Repubblica`, `Monete in euro:Italia` o `Monete europee pre euro:Francia`. La categoria Shopify standard resta neutra; la specializzazione serve alla navigazione e alle regole collezione.
```

If the maintainer wants this only as fix Numisleo temporaneo, do not update ADR; keep the decision in this plan and in the final handoff.

- [ ] **Step 6: Commit**

```bash
git add app/lib/syncbay-shopify-category-mapping.ts app/lib/syncbay-shopify-category-mapping.test.ts docs/decisions/0015-mapping-categorie-ebay-shopify.md
git commit -m "feat: refine collection-grade product types"
```

If ADR was not touched, omit it from `git add`.

---

## Task 5: Collection Intent Loader

**Files:**

- Create: `app/lib/syncbay-collection-intents.ts`
- Create: `app/lib/syncbay-collection-intents.test.ts`

- [ ] **Step 1: Write failing tests for intent validation**

Create `app/lib/syncbay-collection-intents.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { parseCollectionIntents } from "./syncbay-collection-intents.ts";

test("parses valid collection intents", () => {
  const intents = parseCollectionIntents({
    collectionIntents: [
      {
        generic: true,
        handle: "negozio-online",
        requirePositiveInventory: true,
        title: "Negozio Online",
      },
      {
        handle: "banconote",
        productTypeContains: ["Banconote"],
        requirePositiveInventory: true,
        title: "Banconote",
      },
    ],
  });

  assert.equal(intents.length, 2);
  assert.deepEqual(intents[1]?.productTypeContains, ["Banconote"]);
});

test("rejects duplicated handles", () => {
  assert.throws(
    () =>
      parseCollectionIntents({
        collectionIntents: [
          {
            handle: "banconote",
            requirePositiveInventory: true,
            title: "Banconote",
          },
          {
            handle: "banconote",
            requirePositiveInventory: true,
            title: "Banconote duplicate",
          },
        ],
      }),
    /duplicato/i,
  );
});

test("rejects intents without a safe selector", () => {
  assert.throws(
    () =>
      parseCollectionIntents({
        collectionIntents: [{ handle: "regno", requirePositiveInventory: true, title: "Regno" }],
      }),
    /productTypeContains/i,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test --experimental-strip-types app/lib/syncbay-collection-intents.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement parser and file loader**

Create `app/lib/syncbay-collection-intents.ts`:

```ts
import fs from "node:fs";

export interface CollectionRuleIntent {
  generic?: boolean;
  handle: string;
  productTypeContains?: string[];
  requirePositiveInventory: boolean;
  title: string;
}

export function loadCollectionIntents(filePath: string): CollectionRuleIntent[] {
  return parseCollectionIntents(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

export function parseCollectionIntents(value: unknown): CollectionRuleIntent[] {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as { collectionIntents?: unknown }).collectionIntents)
  ) {
    throw new Error("File intenti non valido: atteso { collectionIntents: [...] }.");
  }

  const handles = new Set<string>();
  return (value as { collectionIntents: unknown[] }).collectionIntents.map((raw) => {
    const intent = raw as Partial<CollectionRuleIntent>;
    if (!intent.handle || !intent.title || typeof intent.requirePositiveInventory !== "boolean") {
      throw new Error(
        "Intento collezione non valido: handle, title e requirePositiveInventory sono obbligatori.",
      );
    }
    if (handles.has(intent.handle)) {
      throw new Error(`Handle collezione duplicato: ${intent.handle}`);
    }
    handles.add(intent.handle);
    if (
      !intent.generic &&
      (!Array.isArray(intent.productTypeContains) || intent.productTypeContains.length === 0)
    ) {
      throw new Error(
        `Intento ${intent.handle} senza productTypeContains: non proporre regole specifiche senza selettore affidabile.`,
      );
    }
    return {
      generic: Boolean(intent.generic),
      handle: intent.handle,
      productTypeContains: intent.productTypeContains,
      requirePositiveInventory: intent.requirePositiveInventory,
      title: intent.title,
    };
  });
}
```

Intenti Numisleo reali: crearli solo come file operativo locale sotto
`audits/collections-rule-alignment-YYYY-MM-DD/numisleo-collection-intents.json`,
partendo dalle collezioni live e dalla revisione manuale. Non committare il
file operativo se contiene decisioni specifiche del negozio non ancora
stabilizzate come comportamento SyncBay generale.

- [ ] **Step 4: Run tests**

Run:

```bash
node --test --experimental-strip-types app/lib/syncbay-collection-intents.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/syncbay-collection-intents.ts app/lib/syncbay-collection-intents.test.ts
git commit -m "feat: validate collection rule intents"
```

---

## Task 6: Collections Doctor CLI

**Files:**

- Create: `scripts/syncbay-collections-doctor.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add package script**

Modify `package.json` scripts:

```json
"collections:doctor": "node --experimental-strip-types scripts/syncbay-collections-doctor.mjs"
```

Place it near `categories:backfill` and `facets:backfill`.

- [ ] **Step 2: Create the doctor script**

Create `scripts/syncbay-collections-doctor.mjs` with these behaviors:

```js
#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";

import { buildCollectionCoverageReport } from "../app/lib/syncbay-collection-coverage-report.ts";
import { loadCollectionIntents } from "../app/lib/syncbay-collection-intents.ts";
import { buildCollectionRuleReview } from "../app/lib/syncbay-collection-rule-proposals.ts";

const SHOPIFY_ADMIN_API_VERSION = "2026-07";
const DEFAULT_GENERIC_COLLECTION_HANDLES = ["negozio-online", "non-disponibili"];

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printUsage();
  process.exit(0);
}

if (!args.shop) {
  throw new Error("collections:doctor richiede --shop <shop.myshopify.com>.");
}

if (args.apply && !args.confirmApply) {
  throw new Error("Apply collezioni bloccato: aggiungi --confirm-apply.");
}

if (!args.apply && args.confirmApply) {
  throw new Error("--confirm-apply richiede anche --apply.");
}

if (args.apply && !args.intentFile) {
  throw new Error("Apply collezioni bloccato: serve --intent-file con matrice revisionata.");
}

const collectionIntents = args.intentFile ? loadCollectionIntents(args.intentFile) : [];
const genericCollectionHandles = collectionIntents
  .filter((intent) => intent.generic)
  .map((intent) => intent.handle);
const collections = await loadCollections(args.shop);
const products = await loadProducts(args.shop, args.limitProducts);
const coverage = buildCollectionCoverageReport({
  genericCollectionHandles:
    genericCollectionHandles.length > 0
      ? genericCollectionHandles
      : DEFAULT_GENERIC_COLLECTION_HANDLES,
  products,
});
const review = buildCollectionRuleReview({
  collectionIntents,
  collections,
});

const output = {
  apply: { requested: Boolean(args.apply), planned: review.proposals.length },
  collectionsAnalyzed: collections.length,
  coverage,
  intentFile: args.intentFile ?? null,
  productsAnalyzed: products.length,
  proposals: review.proposals,
  shopDomain: args.shop,
  warnings: review.warnings,
};

if (args.writePlan) {
  fs.writeFileSync(args.writePlan, JSON.stringify(output, null, 2));
}

if (args.apply) {
  await applyProposals(args.shop, review.proposals);
}

if (args.json) {
  console.log(JSON.stringify(output, null, 2));
} else {
  printHumanReport(output);
}

async function loadCollections(shop) {
  const query = `query SyncBayCollectionsDoctorCollections {
    collections(first: 100, sortKey: TITLE) {
      nodes {
        id
        title
        handle
        sortOrder
        productsCount { count }
        ruleSet {
          appliedDisjunctively
          rules { column relation condition }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const data = executeShopifyQuery(shop, query, {});
  const nodes = data.collections?.nodes ?? [];
  if (data.collections?.pageInfo?.hasNextPage) {
    throw new Error(
      "Doctor collezioni bloccato: più di 100 collezioni; aggiungere paginazione prima di procedere.",
    );
  }
  return nodes.map((collection) => ({
    handle: collection.handle,
    id: collection.id,
    ruleSet: collection.ruleSet ?? null,
    title: collection.title,
  }));
}

async function loadProducts(shop, limitProducts) {
  const query = `query SyncBayCollectionsDoctorProducts($after: String) {
    products(first: 250, after: $after, query: "status:active", sortKey: ID) {
      nodes {
        id
        title
        handle
        status
        productType
        totalInventory
        collections(first: 50) { nodes { handle title } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const products = [];
  let after = null;
  while (true) {
    const data = executeShopifyQuery(shop, query, { after });
    products.push(
      ...(data.products?.nodes ?? []).map((product) => ({
        collections: product.collections?.nodes ?? [],
        handle: product.handle,
        id: product.id,
        productType: product.productType ?? null,
        title: product.title,
        totalInventory: Number(product.totalInventory ?? 0),
      })),
    );
    if (limitProducts && products.length >= limitProducts) {
      return products.slice(0, limitProducts);
    }
    const pageInfo = data.products?.pageInfo;
    if (!pageInfo?.hasNextPage) return products;
    after = pageInfo.endCursor;
  }
}

function executeShopifyQuery(shop, query, variables) {
  const output = execFileSync(
    "shopify",
    [
      "store",
      "execute",
      "--store",
      shop,
      "--version",
      SHOPIFY_ADMIN_API_VERSION,
      "--json",
      "--query",
      query,
      "--variables",
      JSON.stringify(variables),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const start = output.indexOf("{");
  if (start < 0) throw new Error(`Shopify CLI non ha restituito JSON: ${output.slice(0, 200)}`);
  const parsed = JSON.parse(output.slice(start));
  if (parsed.errors?.length) throw new Error(JSON.stringify(parsed.errors));
  return parsed;
}

async function applyProposals(shop, proposals) {
  assertCollectionUpdateSupportsLegacyRuleSet(shop);
  for (const proposal of proposals) {
    const mutation = `mutation SyncBayCollectionRuleUpdate($input: CollectionInput!) {
      collectionUpdate(input: $input) {
        collection { id title handle }
        job { id done }
        userErrors { field message }
      }
    }`;
    const output = execFileSync(
      "shopify",
      [
        "store",
        "execute",
        "--store",
        shop,
        "--version",
        SHOPIFY_ADMIN_API_VERSION,
        "--json",
        "--allow-mutations",
        "--query",
        mutation,
        "--variables",
        JSON.stringify({
          input: {
            id: proposal.collectionId,
            ruleSet: proposal.proposedRuleSet,
          },
        }),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const parsed = JSON.parse(output.slice(output.indexOf("{")));
    const payload = parsed.collectionUpdate ?? parsed.data?.collectionUpdate;
    const userErrors = payload?.userErrors ?? [];
    if (userErrors.length > 0) {
      throw new Error(
        `collectionUpdate fallita per ${proposal.title}: ${JSON.stringify(userErrors)}`,
      );
    }
    await waitForShopifyCollectionUpdateJob(shop, payload?.job, proposal.title);
  }
}

async function waitForShopifyCollectionUpdateJob(shop, job, title) {
  if (!job?.id || job.done) return;

  const query = `query SyncBayCollectionUpdateJob($id: ID!) {
    job(id: $id) { id done }
  }`;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const data = executeShopifyQuery(shop, query, { id: job.id });
    if (data.job?.done) return;
  }

  throw new Error(`collectionUpdate non completata per ${title}: job ${job.id}`);
}

function assertCollectionUpdateSupportsLegacyRuleSet(shop) {
  const query = `query SyncBayCollectionMutationContract {
    collectionInput: __type(name: "CollectionInput") {
      inputFields { name }
    }
    mutationType: __schema {
      mutationType {
        fields {
          name
          args { name }
        }
      }
    }
  }`;
  const data = executeShopifyQuery(shop, query, {});
  const hasCollectionUpdateInputArg = data.mutationType?.mutationType?.fields
    ?.find((field) => field.name === "collectionUpdate")
    ?.args?.some((arg) => arg.name === "input");
  const hasRuleSetField = data.collectionInput?.inputFields?.some(
    (field) => field.name === "ruleSet",
  );
  if (!hasCollectionUpdateInputArg || !hasRuleSetField) {
    throw new Error(
      "collectionUpdate legacy input/ruleSet non disponibile: aggiornare l'apply al modello Shopify collection/sources prima di scrivere su Shopify.",
    );
  }
}

function printHumanReport(output) {
  console.log(`Shop: ${output.shopDomain}`);
  console.log(`Prodotti analizzati: ${output.productsAnalyzed}`);
  console.log(`Collezioni analizzate: ${output.collectionsAnalyzed}`);
  console.log(`Disponibili solo in generiche: ${output.coverage.summary.availableOnlyGeneric}`);
  console.log(`Esauriti in specifiche: ${output.coverage.summary.unavailableInSpecific}`);
  console.log(`Proposte regole: ${output.proposals.length}`);
  console.log(`Warning regole: ${output.warnings.length}`);
  for (const row of output.coverage.availableOnlyGeneric.slice(0, 20)) {
    console.log(`- scoperto: ${row.handle} | ${row.productType ?? "(tipo vuoto)"} | ${row.title}`);
  }
  for (const row of output.coverage.unavailableInSpecific.slice(0, 20)) {
    console.log(`- esaurito in specifica: ${row.handle} | ${row.specificCollections.join(", ")}`);
  }
  for (const proposal of output.proposals) {
    console.log(`- proposta: ${proposal.title} | ${proposal.reason}`);
  }
  for (const warning of output.warnings) {
    console.log(`- warning: ${warning.title} | ${warning.reason} | ${warning.message}`);
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--shop") parsed.shop = argv[++index];
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--apply") parsed.apply = true;
    else if (arg === "--confirm-apply") parsed.confirmApply = true;
    else if (arg === "--intent-file") parsed.intentFile = argv[++index];
    else if (arg === "--write-plan") parsed.writePlan = argv[++index];
    else if (arg === "--limit-products") parsed.limitProducts = Number(argv[++index]);
    else throw new Error(`Argomento non riconosciuto: ${arg}`);
  }
  return parsed;
}

function printUsage() {
  console.log(`Uso: npm run collections:doctor -- --shop numisleo.myshopify.com [--intent-file file.json] [--json] [--write-plan file.json] [--limit-products N] [--apply --confirm-apply]

Dry-run di default. Analizza prodotti attivi, copertura collezioni e proposte
di regole automatiche. Non crea collezioni e non scrive su Shopify senza apply
esplicito. Senza --intent-file produce solo copertura; proposte e apply richiedono una matrice intenti revisionata.`);
}
```

- [ ] **Step 3: Run doctor against a small sample**

Run:

```bash
npm run collections:doctor -- --shop numisleo.myshopify.com --limit-products 50 --json
```

Expected: JSON output with `productsAnalyzed: 50`, `apply.requested: false`, `proposals: []`, no Shopify mutations.

- [ ] **Step 4: Create a local Numisleo intent file for reviewed productType rules**

Run:

```bash
mkdir -p audits/collections-rule-alignment-$(date +%F)
cat > audits/collections-rule-alignment-$(date +%F)/numisleo-collection-intents.json <<'JSON'
{
  "collectionIntents": [
    { "generic": true, "handle": "negozio-online", "requirePositiveInventory": true, "title": "Negozio Online" },
    { "generic": true, "handle": "non-disponibili", "requirePositiveInventory": false, "title": "Non disponibili" },
    { "handle": "banconote", "productTypeContains": ["Banconote"], "requirePositiveInventory": true, "title": "Banconote" },
    { "handle": "francobolli", "productTypeContains": ["Francobolli"], "requirePositiveInventory": true, "title": "Francobolli" },
    { "handle": "medaglie-italiane-ed-estere", "productTypeContains": ["Medaglie"], "requirePositiveInventory": true, "title": "Medaglie italiane ed estere" },
    { "handle": "monete-del-regno-ditalia", "productTypeContains": ["Monete italiane in lire:Regno"], "requirePositiveInventory": true, "title": "Monete del Regno d'Italia" },
    { "handle": "lire-della-repubblica-italiana", "productTypeContains": ["Monete italiane in lire:Repubblica"], "requirePositiveInventory": true, "title": "Lire della Repubblica italiana" },
    { "handle": "euro-italia", "productTypeContains": ["Monete in euro:Italia"], "requirePositiveInventory": true, "title": "Euro Italia" },
    { "handle": "monete-europee", "productTypeContains": ["Monete europee pre euro"], "requirePositiveInventory": true, "title": "Monete europee" }
  ]
}
JSON
```

Expected: local intent file exists under ignored `audits/`. It intentionally
omits `Accessori numismatici` until the maintainer chooses between title-driven
logic and productType-driven logic.

- [ ] **Step 5: Run doctor full dry-run and save plan**

Run:

```bash
mkdir -p audits/collections-rule-alignment-$(date +%F)
npm run collections:doctor -- \
  --shop numisleo.myshopify.com \
  --intent-file audits/collections-rule-alignment-$(date +%F)/numisleo-collection-intents.json \
  --json \
  --write-plan audits/collections-rule-alignment-$(date +%F)/doctor-plan.json
```

Expected: full report saved locally; no mutation flags are used.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/syncbay-collections-doctor.mjs
git commit -m "feat: add collections doctor"
```

---

## Task 7: Review The Proposed Rule Matrix Before Any Apply

**Files:**

- Local only: `audits/collections-rule-alignment-YYYY-MM-DD/doctor-plan.json`
- Optional docs handoff: `docs/superpowers/plans/2026-07-05-numisleo-collection-rule-alignment.md`

- [ ] **Step 1: Inspect proposed changes**

Run:

```bash
node <<'NODE'
const fs = require("node:fs");
const path = `audits/collections-rule-alignment-${new Date().toISOString().slice(0, 10)}/doctor-plan.json`;
const report = JSON.parse(fs.readFileSync(path, "utf8"));
for (const proposal of report.proposals) {
  console.log(`\\n${proposal.title} (${proposal.handle})`);
  console.log(`Reason: ${proposal.reason}`);
  console.log("Current:", JSON.stringify(proposal.currentRuleSet));
  console.log("Proposed:", JSON.stringify(proposal.proposedRuleSet));
}
NODE
```

Expected: every proposed rule update is visible before apply.

- [ ] **Step 2: Review warnings and manually reject unsafe proposals**

First inspect `report.warnings`. A warning is not a failure by itself, but it blocks automatic apply for that collection until the intent file is changed with a safe selector or the collection is intentionally left as-is.

Reject a proposal if any of these are true:

- It would create a collection rule without `VARIANT_INVENTORY > 0` for a specific sellable collection.
- It would transform title rules connected by `OR` into `AND` rules.
- It would replace a precise title rule with a broader `TYPE` rule without evidence.
- It would touch `Negozio Online` or `Non disponibili`.
- It would alter collection identity fields, handle, SEO, image, description or publication.
- It uses `Monete italiane` by itself for a specific subcollection.

Expected: unsafe proposals are removed by changing the local `--intent-file`, not by editing the generated JSON by hand or by changing `scripts/syncbay-collections-doctor.mjs`.

- [ ] **Step 3: Re-run dry-run after intent changes**

Run:

```bash
npm run collections:doctor -- \
  --shop numisleo.myshopify.com \
  --intent-file audits/collections-rule-alignment-$(date +%F)/numisleo-collection-intents.json \
  --json \
  --write-plan audits/collections-rule-alignment-$(date +%F)/doctor-plan-reviewed.json
```

Expected: only approved, conservative proposals remain.

---

## Task 8: Apply Collection Rule Updates To Numisleo

**Files:**

- Modify remote Shopify collections only after maintainer approval.
- No repository file must change during apply except optional audit docs.

- [ ] **Step 1: Ask for explicit maintainer go**

Required phrase from maintainer before apply:

```text
Applica le regole collezione su Numisleo
```

Do not run apply without that explicit go.

- [ ] **Step 2: Apply with double confirmation**

Run:

```bash
npm run collections:doctor -- \
  --shop numisleo.myshopify.com \
  --intent-file audits/collections-rule-alignment-$(date +%F)/numisleo-collection-intents.json \
  --apply \
  --confirm-apply \
  --write-plan audits/collections-rule-alignment-$(date +%F)/doctor-apply-result.json
```

Expected: Shopify collection mutations run only for approved `collectionId`
values. No new collection is created. If Shopify returns an asynchronous
`collectionUpdate.job`, the command waits until the job reports `done` before
continuing. If the current Shopify Admin API no longer supports legacy
`input.ruleSet`, the command fails before mutation and the apply path must be
updated to `collection.sources`.

- [ ] **Step 3: Verify Admin API after apply**

Run:

```bash
npm run collections:doctor -- \
  --shop numisleo.myshopify.com \
  --intent-file audits/collections-rule-alignment-$(date +%F)/numisleo-collection-intents.json \
  --json \
  --write-plan audits/collections-rule-alignment-$(date +%F)/doctor-post-apply.json
```

Expected target:

- `coverage.summary.availableOnlyGeneric` is `0`, or every residual row is explicitly documented as a productType mapper gap.
- `coverage.summary.unavailableInSpecific` is `0`.
- `proposals.length` is `0`, or residual proposals are intentionally deferred.

- [ ] **Step 4: Smoke storefront collection URLs**

Run:

```bash
node <<'NODE'
const urls = [
  "https://numisleo.it/collections/negozio-online",
  "https://numisleo.it/collections/accessori-numismatici",
  "https://numisleo.it/collections/banconote",
  "https://numisleo.it/collections/medaglie-italiane-ed-estere",
  "https://numisleo.it/collections/monete-del-regno-ditalia",
  "https://numisleo.it/collections/lire-della-repubblica-italiana",
  "https://numisleo.it/collections/euro-italia",
];
for (const url of urls) {
  const response = await fetch(`${url}?_syncbay_check=${Date.now()}`);
  console.log(`${response.status} ${url}`);
  if (!response.ok) process.exitCode = 1;
}
NODE
```

Expected: each URL returns `200`.

---

## Task 9: Documentation And Release Classification

**Files:**

- Modify: `docs/TOOLCHAIN.md`
- Modify: `docs/CONTEXT.md` if project state changes
- Modify: `CHANGELOG.md` if mapper/script changes are versioned runtime/tooling
- Possibly modify: `docs/decisions/0015-mapping-categorie-ebay-shopify.md`
- If remote Numisleo apply is completed, also update `/Users/Matteo/Progetti/Numisleo/docs/audit-log.md` and `/Users/Matteo/Progetti/Numisleo/docs/CONTEXT.md`

- [ ] **Step 1: Document the new command**

Add to `docs/TOOLCHAIN.md` near category/facet backfills:

```markdown
`npm run collections:doctor` è un doctor operativo dry-run di default: legge
prodotti e collezioni Shopify via Admin GraphQL/Shopify CLI, segnala prodotti
disponibili solo in collezioni generiche, prodotti esauriti dentro collezioni
specifiche e proposte conservative di regole automatiche. Non crea collezioni,
non cambia handle/SEO/immagini/descrizioni e non scrive su Shopify senza
`--intent-file`, `--apply` e `--confirm-apply`.
```

- [ ] **Step 2: Add changelog entry if code changed**

If `syncbay-shopify-category-mapping.ts`, `scripts/syncbay-collections-doctor.mjs`, or package scripts changed, add to `CHANGELOG.md`:

```markdown
### Sotto il cofano

- Aggiunto doctor operativo per verificare la copertura delle collezioni Shopify esistenti rispetto ai nuovi prodotti sincronizzati da SyncBay.
- Raffinati i `productType` derivati da categorie eBay affidabili per ridurre prodotti disponibili fuori dalle collezioni specifiche.
```

Classification: `PATCH` if only hardening/doctor/productType refinement; `MINOR` only if exposed as new merchant-facing feature in the embedded UI.

- [ ] **Step 3: Update Numisleo docs only after live apply**

If Task 8 ran, update Numisleo:

```bash
cd /Users/Matteo/Progetti/Numisleo
```

Add an entry to `docs/audit-log.md`:

```markdown
## Riadattamento regole collezioni per SyncBay 2026-07-05

- Eseguito audit read-only sulle collezioni Shopify esistenti dopo l'arrivo di nuovi prodotti SyncBay.
- Obiettivo: mantenere le collezioni esistenti e rendere le regole automatiche compatibili con i `productType` generati da SyncBay.
- Prima dell'intervento: indicare conteggi da `doctor-plan-reviewed.json`.
- Apply: indicare collezioni aggiornate e regole cambiate, senza dati personali.
- Verifica post-write: indicare conteggi da `doctor-post-apply.json` e smoke URL storefront.
- Nessuna nuova collezione creata; handle, URL, SEO, immagini e descrizioni preservati.
```

Expected: Numisleo docs reflect remote Shopify changes. If Task 8 did not run, do not update Numisleo as if apply happened.

---

## Task 10: Verification Gates

**Files:**

- All changed files.

- [ ] **Step 1: Run targeted lib tests**

Run:

```bash
node --test --experimental-strip-types \
  app/lib/syncbay-collection-coverage-report.test.ts \
  app/lib/syncbay-collection-intents.test.ts \
  app/lib/syncbay-collection-rule-proposals.test.ts \
  app/lib/syncbay-shopify-category-mapping.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full lib suite**

Run:

```bash
npm run test:lib
```

Expected: PASS.

- [ ] **Step 3: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Build if mapper/runtime changed**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Diff check**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 7: Self-review**

Run:

```bash
npm run review:pre-pr
```

Expected: no blocker. If the script flags provider/live apply docs or release classification, resolve before PR.

---

## Task 11: Publish Path

**Files:**

- Changed implementation/docs files only.

- [ ] **Step 1: Classify release**

Rules:

- If only this plan document exists: non versionato, no release.
- If `collections:doctor` script is added and mapper unchanged: `PATCH`, unless maintainer decides tooling-only non release.
- If mapper changes product output for new imports/sync: `PATCH`.
- If embedded UI exposes collection doctor to merchants: `MINOR`, but that is out of scope for this plan.

- [ ] **Step 2: If versioned, run release dry-run**

Run:

```bash
npm run release:dry-run
```

Expected: release category matches classification.

- [ ] **Step 3: Stage only this task's files**

Run:

```bash
git status --short
git add \
  app/lib/syncbay-collection-coverage-report.ts \
  app/lib/syncbay-collection-coverage-report.test.ts \
  app/lib/syncbay-collection-rule-proposals.ts \
  app/lib/syncbay-collection-rule-proposals.test.ts \
  app/lib/syncbay-shopify-category-mapping.ts \
  app/lib/syncbay-shopify-category-mapping.test.ts \
  scripts/syncbay-collections-doctor.mjs \
  package.json \
  docs/TOOLCHAIN.md \
  docs/decisions/0015-mapping-categorie-ebay-shopify.md \
  CHANGELOG.md
```

Omit files that were not changed. Do not stage unrelated existing plan changes.

- [ ] **Step 4: Commit**

Run:

```bash
git commit -m "feat: align collection rules with SyncBay product types"
```

Use `fix:` instead if the final diff is only mapper correction and doctor hardening.

- [ ] **Step 5: PR**

Run provider-assisted GitHub tooling if available. If unavailable, use `gh` fallback:

```bash
gh pr create \
  --base main \
  --head codex/numisleo-collection-rules \
  --title "feat: align collection rules with SyncBay product types" \
  --body "Aggiunge un doctor operativo per verificare collezioni Shopify esistenti rispetto ai nuovi prodotti SyncBay e raffina i productType usati dalle regole automatiche."
```

Expected: PR title is Conventional Commit, not the branch name.

---

## Acceptance Criteria

- `collections:doctor` dry-run reports live collection coverage without writing Shopify.
- Existing Numisleo collections are preserved; no new collection is created.
- Specific collections can be checked for `VARIANT_INVENTORY > 0`.
- Rule proposals are explicit and reviewable before apply.
- Mapper tests prevent `Monete italiane` from being used for obvious non-Italian pre-euro coins.
- New product types are specific enough for collection rules where eBay category provides reliable subpaths.
- Apply requires explicit maintainer go plus `--apply --confirm-apply`.
- Post-apply target is `0` available products only in generic collections and `0` unavailable products in specific collections, except explicitly documented mapper gaps.

## Open Questions For Maintainer Before Apply

- Should `Accessori numismatici` remain title-driven with inventory guard, or should it become `TYPE CONTAINS Cataloghi e accessori` plus stricter exclusions?
- Should `Monete fondo specchio proof`, `Sterline d'oro`, `Marenghi d'oro`, `Monete di Brescia` and `Monete di Casa Savoia` remain title-driven because they are commercial slices, not pure category slices?
- Should productType values keep the shorter SyncBay style (`Monete italiane in lire:Regno`) or intentionally match legacy Numisleo paths (`Monete e banconote:Monete italiane in lire:Regno`) for backwards compatibility?

## Self-Review

- Spec coverage: the plan covers audit, collection rule adaptation, mapper corrections, doctor CLI, apply gate, verification, docs and publish classification.
- Placeholder scan: no task relies on unspecified implementation paths; unsafe areas are explicit open questions before apply.
- Type consistency: proposal tests and implementation snippets use the same `CollectionRuleIntent`, `ShopifyCollectionRuleSet`, `buildCollectionCoverageReport`, `loadCollectionIntents` and `buildCollectionRuleReview` names.
- Scope check: no new runtime, worker, collection creation, metafield navigation or embedded UI is included.

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
const genericCollectionHandles =
  collectionIntents.filter((intent) => intent.generic).map((intent) => intent.handle);
const collections = await loadCollections(args.shop);
const products = await loadProducts(args.shop, args.limitProducts);
const coverage = buildCollectionCoverageReport({
  genericCollectionHandles:
    genericCollectionHandles.length > 0 ? genericCollectionHandles : DEFAULT_GENERIC_COLLECTION_HANDLES,
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
    throw new Error("Doctor collezioni bloccato: più di 100 collezioni; aggiungere paginazione prima di procedere.");
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
    products.push(...((data.products?.nodes ?? []).map((product) => ({
      collections: product.collections?.nodes ?? [],
      handle: product.handle,
      id: product.id,
      productType: product.productType ?? null,
      title: product.title,
      totalInventory: Number(product.totalInventory ?? 0),
    }))));
    if (limitProducts && products.length >= limitProducts) {
      return products.slice(0, limitProducts);
    }
    const pageInfo = data.products?.pageInfo;
    if (!pageInfo?.hasNextPage) return products;
    after = pageInfo.endCursor;
  }
}

function executeShopifyQuery(shop, query, variables) {
  const output = execFileSync("shopify", [
    "store", "execute",
    "--store", shop,
    "--version", SHOPIFY_ADMIN_API_VERSION,
    "--json",
    "--query", query,
    "--variables", JSON.stringify(variables),
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
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
    const output = execFileSync("shopify", [
      "store", "execute",
      "--store", shop,
      "--version", SHOPIFY_ADMIN_API_VERSION,
      "--json",
      "--allow-mutations",
      "--query", mutation,
      "--variables", JSON.stringify({
        input: {
          id: proposal.collectionId,
          ruleSet: proposal.proposedRuleSet,
        },
      }),
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
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

  throw new Error(
    `collectionUpdate non completata per ${title}: job ${job.id}`,
  );
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
  const hasRuleSetField = data.collectionInput?.inputFields?.some((field) => field.name === "ruleSet");
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

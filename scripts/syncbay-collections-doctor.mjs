#!/usr/bin/env node
import { parseArgs as parseNodeArgs } from "node:util";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

import { buildCollectionCoverageReport } from "../app/lib/syncbay-collection-coverage-report.ts";
import { loadCollectionIntents } from "../app/lib/syncbay-collection-intents.ts";
import { buildCollectionRuleReview } from "../app/lib/syncbay-collection-rule-proposals.ts";
import { buildSourcesUpdate } from "../app/lib/syncbay-collection-sources-apply.ts";
import { conditionsSourceToRuleSet } from "../app/lib/syncbay-collection-sources-read.ts";

const SHOPIFY_ADMIN_API_VERSION = "2026-07";
const DEFAULT_GENERIC_COLLECTION_HANDLES = [
  "negozio-online",
  "non-disponibili",
];

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
  throw new Error(
    "Apply collezioni bloccato: serve --intent-file con matrice revisionata.",
  );
}

const collectionIntents = args.intentFile
  ? loadCollectionIntents(args.intentFile)
  : [];
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
        sources {
          __typename
          ... on CollectionConditionsSource {
            id
            inclusion {
              matchType
              conditions {
                __typename
                ... on CollectionSourceInclusionConditionProductType { relation values }
                ... on CollectionSourceInclusionConditionProductTitle { relation values }
                ... on CollectionSourceInclusionConditionProductTag { relation values }
                ... on CollectionSourceInclusionConditionProductVendor { relation values }
                ... on CollectionSourceInclusionConditionVariantInventory { relation value }
              }
            }
          }
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
  return nodes.map((collection) => {
    const conditionsSource = (collection.sources ?? []).find(
      (source) => source.__typename === "CollectionConditionsSource",
    );
    return {
      handle: collection.handle,
      id: collection.id,
      ruleSet: conditionsSourceToRuleSet(conditionsSource ?? null),
      title: collection.title,
    };
  });
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
  if (start < 0)
    throw new Error(
      `Shopify CLI non ha restituito JSON: ${output.slice(0, 200)}`,
    );
  const parsed = JSON.parse(output.slice(start));
  if (parsed.errors?.length) throw new Error(JSON.stringify(parsed.errors));
  return parsed;
}

async function applyProposals(shop, proposals) {
  assertCollectionUpdateSupportsSourcesModel(shop);
  for (const proposal of proposals) {
    const currentSource = loadConditionsSource(
      shop,
      proposal.collectionId,
      proposal.title,
    );
    const sourcesUpdate = buildSourcesUpdate({
      currentSource,
      proposedRuleSet: proposal.proposedRuleSet,
    });
    const mutation = `mutation SyncBayCollectionSourcesUpdate($collection: CollectionUpdateInput!) {
      collectionUpdate(collection: $collection) {
        collection { id title handle }
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
          collection: {
            id: proposal.collectionId,
            sourcesToUpdate: [sourcesUpdate],
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
  }
}

function loadConditionsSource(shop, collectionId, title) {
  const query = `query SyncBayCollectionConditionsSource($id: ID!) {
    collection(id: $id) {
      id
      sources {
        __typename
        ... on CollectionConditionsSource {
          id
          inclusion {
            matchType
            conditions {
              __typename
              id
              ... on CollectionSourceInclusionConditionProductType { relation values }
              ... on CollectionSourceInclusionConditionVariantInventory { relation value }
            }
          }
        }
      }
    }
  }`;
  const data = executeShopifyQuery(shop, query, { id: collectionId });
  const source = (data.collection?.sources ?? []).find(
    (item) => item.__typename === "CollectionConditionsSource",
  );
  if (!source?.id || !source.inclusion) {
    throw new Error(
      `Nessuna CollectionConditionsSource trovata per ${title}: apply sources bloccato.`,
    );
  }
  return source;
}

function assertCollectionUpdateSupportsSourcesModel(shop) {
  const query = `query SyncBayCollectionMutationContract {
    collectionUpdateInput: __type(name: "CollectionUpdateInput") {
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
  const hasCollectionUpdateCollectionArg =
    data.mutationType?.mutationType?.fields
      ?.find((field) => field.name === "collectionUpdate")
      ?.args?.some((arg) => arg.name === "collection");
  const hasSourcesToUpdate = data.collectionUpdateInput?.inputFields?.some(
    (field) => field.name === "sourcesToUpdate",
  );
  if (!hasCollectionUpdateCollectionArg || !hasSourcesToUpdate) {
    throw new Error(
      "collectionUpdate sources model non disponibile: lo schema Shopify non espone collectionUpdate(collection:)/sourcesToUpdate. Rivedere l'apply prima di scrivere su Shopify.",
    );
  }
}

function printHumanReport(output) {
  console.log(`Shop: ${output.shopDomain}`);
  console.log(`Prodotti analizzati: ${output.productsAnalyzed}`);
  console.log(`Collezioni analizzate: ${output.collectionsAnalyzed}`);
  console.log(
    `Disponibili solo in generiche: ${output.coverage.summary.availableOnlyGeneric}`,
  );
  console.log(
    `Esauriti in specifiche: ${output.coverage.summary.unavailableInSpecific}`,
  );
  console.log(`Proposte regole: ${output.proposals.length}`);
  console.log(`Warning regole: ${output.warnings.length}`);
  for (const row of output.coverage.availableOnlyGeneric.slice(0, 20)) {
    console.log(
      `- scoperto: ${row.handle} | ${row.productType ?? "(tipo vuoto)"} | ${row.title}`,
    );
  }
  for (const row of output.coverage.unavailableInSpecific.slice(0, 20)) {
    console.log(
      `- esaurito in specifica: ${row.handle} | ${row.specificCollections.join(", ")}`,
    );
  }
  for (const proposal of output.proposals) {
    console.log(`- proposta: ${proposal.title} | ${proposal.reason}`);
  }
  for (const warning of output.warnings) {
    console.log(
      `- warning: ${warning.title} | ${warning.reason} | ${warning.message}`,
    );
  }
}

function parseArgs(argv) {
  const { values } = parseNodeArgs({
    args: argv,
    options: {
      apply: { type: "boolean" },
      "confirm-apply": { type: "boolean" },
      help: { short: "h", type: "boolean" },
      "intent-file": { type: "string" },
      json: { type: "boolean" },
      "limit-products": { type: "string" },
      shop: { type: "string" },
      "write-plan": { type: "string" },
    },
  });

  return {
    apply: values.apply,
    confirmApply: values["confirm-apply"],
    help: values.help,
    intentFile: values["intent-file"],
    json: values.json,
    limitProducts:
      values["limit-products"] === undefined
        ? undefined
        : Number(values["limit-products"]),
    shop: values.shop,
    writePlan: values["write-plan"],
  };
}

function printUsage() {
  console.log(`Uso: npm run collections:doctor -- --shop numisleo.myshopify.com [--intent-file file.json] [--json] [--write-plan file.json] [--limit-products N] [--apply --confirm-apply]

Dry-run di default. Analizza prodotti attivi, copertura collezioni e proposte
di regole automatiche. Non crea collezioni e non scrive su Shopify senza apply
esplicito. Senza --intent-file produce solo copertura; proposte e apply richiedono una matrice intenti revisionata.`);
}

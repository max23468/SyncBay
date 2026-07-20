#!/usr/bin/env node
import { parseArgs as parseNodeArgs } from "node:util";

import { mapWithConcurrency } from "../app/lib/map-with-concurrency.ts";
import {
  buildProductFacetApplyPlan,
  buildProductFacetBackfillReport,
} from "../app/lib/syncbay-product-facet-backfill-report.ts";
import {
  buildSyncBayProductFacets,
  parseEbayTradingItemSpecifics,
} from "../app/lib/syncbay-product-facets.ts";
import { parsePositiveLimitOption } from "../app/lib/syncbay-cli-args.ts";
import { getProductFacetsFromSnapshotPayload } from "../app/lib/syncbay-product-snapshot-payload.ts";
import { querySupabaseJson, sqlQuote } from "./supabase-cli-env.mjs";
import {
  asRecord,
  ensureTokenEncryptionKey,
  getAccessToken,
  getShopifyAccessToken,
  getString,
  getTradingItem,
  loadDotEnv,
} from "./syncbay-ebay-cli.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";

const SHOPIFY_ADMIN_API_VERSION = "2026-07";
const MAX_RUNTIME_PRODUCT_BATCH_SIZE = 20;
const GET_ITEM_CONCURRENCY = 4;
const APPLY_CONCURRENCY = 4;
const FACET_NAMESPACE = "syncbay_facets";
const APPLY_FACETS_MUTATION = `mutation SyncBayApplyFacetMetafields($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields {
      id
      key
      namespace
    }
    userErrors {
      code
      field
      message
    }
  }
}`;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printUsage();
  process.exit(0);
}

loadDotEnv(".env");

const shopDomain = resolveRequiredShopDomainOption({
  args,
  env: process.env,
});

ensureTokenEncryptionKey();

await main().catch((error) => {
  console.error(`Backfill faccette non riuscito: ${formatError(error)}`);
  process.exit(1);
});

async function main() {
  if (args.apply && !args.confirmApply) {
    throw new Error("Apply faccette bloccato: aggiungi --confirm-apply per scrivere su Shopify.");
  }

  if (!args.apply && args.confirmApply) {
    throw new Error("--confirm-apply richiede anche --apply.");
  }

  const state = await getBackfillState();
  if (!state.connection) {
    throw new Error(`Nessuna connessione eBay attiva per ${shopDomain}.`);
  }

  if (
    args.apply &&
    state.shopifySession?.scope &&
    !hasScope(state.shopifySession.scope, "write_products")
  ) {
    throw new Error(
      "Apply faccette bloccato: la sessione offline Shopify non espone write_products.",
    );
  }

  const allMappings = Array.isArray(state.mappings) ? state.mappings : [];
  const mappings = args.limit ? allMappings.slice(0, args.limit) : allMappings;
  if (mappings.length === 0) {
    throw new Error("Nessun mapping ACTIVE da analizzare.");
  }

  const shopifyAccessToken = await getShopifyAccessToken(state.shopifySession, shopDomain);
  const shopifyProducts = await loadShopifyProducts({
    accessToken: shopifyAccessToken,
    productGids: mappings.map((row) => row.shopifyProductGid).filter(Boolean),
  });
  const ebayToken = args.snapshotOnly ? null : await getAccessToken(state.connection);
  const rows = await mapWithConcurrency(mappings, GET_ITEM_CONCURRENCY, async (mapping) =>
    buildReportRow({
      accessToken: ebayToken?.accessToken ?? null,
      connection: state.connection,
      mapping,
      shopifyProduct: shopifyProducts.get(mapping.shopifyProductGid) ?? null,
    }),
  );
  const report = buildProductFacetBackfillReport({
    rows,
    shopDomain,
  });
  const applyPlan = buildProductFacetApplyPlan(report);
  const applyResult = args.apply
    ? await applyFacetPlan({
        accessToken: shopifyAccessToken,
        plan: applyPlan,
      })
    : null;
  const output = {
    ...report,
    analyzed: mappings.length,
    apply: applyResult ?? {
      planned: applyPlan.rows.length,
      requested: false,
      skipped: applyPlan.skipped,
    },
    activeMappingsTotal: allMappings.length,
    partial: Boolean(args.limit && args.limit < allMappings.length),
    source: args.snapshotOnly ? "snapshot" : "trading_with_snapshot_fallback",
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    if (applyResult?.failed > 0) process.exitCode = 1;
    return;
  }

  printReport(output);
  printApplySummary(output.apply);
  if (applyResult?.failed > 0) process.exitCode = 1;
}

async function buildReportRow(input) {
  const snapshotSource = getSnapshotFacetSource(input.mapping);
  let snapshotProductFacets = getProductFacetsFromSnapshotPayload(input.mapping.ebayPayload);
  let source = snapshotSource;
  let lookupFailureReason = null;
  let lookupFailed = false;

  if (input.accessToken) {
    try {
      const item = await getTradingItem({
        accessToken: input.accessToken,
        connection: input.connection,
        includeItemSpecifics: true,
        itemId: input.mapping.ebayItemId,
      });
      source = {
        ebayPrimaryCategoryName:
          getPrimaryCategoryName(item) ?? snapshotSource.ebayPrimaryCategoryName,
        itemSpecifics: parseEbayTradingItemSpecifics(item.ItemSpecifics),
        storeCategoryName: getStorefrontCategoryName(item) ?? snapshotSource.storeCategoryName,
        title: getString(item, "Title") ?? snapshotSource.title,
      };
      snapshotProductFacets = [];
    } catch (error) {
      lookupFailureReason = formatError(error);
      lookupFailed = true;
    }
  }

  return {
    currentMetafields: getCurrentFacetMetafields(input.shopifyProduct),
    ebayItemId: input.mapping.ebayItemId,
    lookupFailureReason,
    lookupFailed,
    proposedFacets:
      snapshotProductFacets.length > 0 ? snapshotProductFacets : buildSyncBayProductFacets(source),
    shopifyProductGid: input.shopifyProduct ? (input.mapping.shopifyProductGid ?? null) : null,
  };
}

function getSnapshotFacetSource(mapping) {
  const payload = asRecord(mapping.ebayPayload);

  return {
    ebayPrimaryCategoryName: normalizeText(payload?.ebayPrimaryCategoryName),
    itemSpecifics: [],
    storeCategoryName: normalizeText(payload?.storeCategoryName),
    title: normalizeText(mapping.ebayTitle),
  };
}

function getCurrentFacetMetafields(product) {
  return (product?.metafields?.nodes ?? []).flatMap((metafield) => {
    if (metafield?.namespace !== FACET_NAMESPACE) return [];
    if (!metafield.key || !metafield.type || typeof metafield.value !== "string") {
      return [];
    }

    return [
      {
        key: metafield.key,
        namespace: metafield.namespace,
        type: metafield.type,
        value: metafield.value,
      },
    ];
  });
}

async function getBackfillState() {
  const { rows } = await querySupabaseJson(`
with shop_row as (
  select id
  from "Shop"
  where "shopDomain" = ${sqlQuote(shopDomain)}
  limit 1
),
connection as (
  select ec.*
  from "EbayConnection" ec
  join shop_row s on s.id = ec."shopId"
  where ec."marketplaceId" = 'EBAY_IT'
    and ec.status = 'CONNECTED'
  limit 1
),
latest_ebay_snapshot as (
  select distinct on (ps."mappingId")
    ps."mappingId",
    ps.title as "ebayTitle",
    ps.payload as "ebayPayload",
    ps."capturedAt"
  from "ProductSnapshot" ps
  join shop_row s on s.id = ps."shopId"
  where ps.source = 'EBAY'
  order by ps."mappingId", ps."capturedAt" desc
),
mappings as (
  select
    pm."ebayItemId",
    pm."shopifyProductGid",
    latest_ebay_snapshot."ebayTitle",
    latest_ebay_snapshot."ebayPayload"
  from "ProductMapping" pm
  join shop_row s on s.id = pm."shopId"
  left join latest_ebay_snapshot on latest_ebay_snapshot."mappingId" = pm.id
  where pm.status = 'ACTIVE'
  order by pm."ebayItemId"
)
select jsonb_build_object(
  'connection', (select to_jsonb(connection) from connection),
  'shopifySession', (
    select to_jsonb(session_row)
    from (
      select id, "accessToken", expires, "refreshToken", "refreshTokenExpires", scope
      from "Session"
      where id = ${sqlQuote(`offline_${shopDomain}`)}
      limit 1
    ) session_row
  ),
  'mappings', coalesce((select jsonb_agg(to_jsonb(mappings)) from mappings), '[]'::jsonb)
) as payload;
`);

  return rows[0]?.payload ?? {};
}

async function loadShopifyProducts(input) {
  const uniqueProductGids = [...new Set(input.productGids)];
  const products = new Map();

  for (const batch of chunkArray(uniqueProductGids, MAX_RUNTIME_PRODUCT_BATCH_SIZE)) {
    const response = await fetch(
      `https://${shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`,
      {
        body: JSON.stringify({
          query: `query SyncBayFacetBackfillProducts($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product {
      id
      metafields(first: 20, namespace: "syncbay_facets") {
        nodes {
          key
          namespace
          type
          value
        }
      }
    }
  }
}`,
          variables: { ids: batch },
        }),
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": input.accessToken,
        },
        method: "POST",
      },
    );
    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.errors) {
      throw new Error(`Shopify Admin GraphQL non disponibile (HTTP ${response.status}).`);
    }

    for (const product of payload?.data?.nodes ?? []) {
      if (product?.id) products.set(product.id, product);
    }
  }

  return products;
}

async function applyFacetPlan(input) {
  const results = await mapWithConcurrency(input.plan.rows, APPLY_CONCURRENCY, async (row) =>
    applyFacetRow({
      accessToken: input.accessToken,
      row,
    }),
  );
  const failures = results.filter((result) => !result.ok);

  return {
    applied: results.length - failures.length,
    failed: failures.length,
    failures: failures.slice(0, 20),
    planned: input.plan.rows.length,
    requested: true,
    skipped: input.plan.skipped,
  };
}

async function applyFacetRow(input) {
  const response = await fetch(
    `https://${shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`,
    {
      body: JSON.stringify({
        query: APPLY_FACETS_MUTATION,
        variables: {
          metafields: input.row.metafields,
        },
      }),
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": input.accessToken,
      },
      method: "POST",
    },
  );
  const payload = await response.json().catch(() => null);

  if (!response.ok || payload?.errors) {
    return {
      ebayItemId: input.row.ebayItemId,
      error: `Shopify Admin GraphQL HTTP ${response.status}`,
      ok: false,
      shopifyProductGid: input.row.shopifyProductGid,
    };
  }

  const userErrors = payload?.data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      ebayItemId: input.row.ebayItemId,
      error: userErrors
        .map((error) => `${error.field?.join(".") ?? "metafields"}: ${error.message}`)
        .join("; "),
      ok: false,
      shopifyProductGid: input.row.shopifyProductGid,
    };
  }

  return {
    ebayItemId: input.row.ebayItemId,
    ok: true,
    shopifyProductGid: input.row.shopifyProductGid,
  };
}

function getPrimaryCategoryName(item) {
  return getString(asRecord(item?.PrimaryCategory), "CategoryName");
}

function getStorefrontCategoryName(item) {
  const storefront = asRecord(item?.Storefront);
  const rawId = getString(storefront, "StoreCategoryID");
  const normalizedId = rawId && rawId !== "0" && rawId !== "-999" ? rawId : null;
  const name = getString(storefront, "StoreCategoryName");

  return normalizedId && name ? name : null;
}

function printReport(report) {
  console.log(
    "Modalità diagnostica/emergenza: il backfill ordinario faccette passa dal runner incrementale facetOnly.",
  );
  console.log("");
  console.log(`Shop: ${report.shopDomain}`);
  console.log(`Fonte: ${report.source}`);
  console.log(`Mapping ACTIVE totali: ${report.activeMappingsTotal}`);
  console.log(
    `Analizzati: ${report.analyzed}${report.partial ? " (parziale, usa senza --limit per la lista completa)" : ""}`,
  );
  console.log(`Applicabili: ${report.summary.applicable}`);
  console.log(`Già corretti: ${report.summary.alreadyCorrect}`);
  console.log(`Conflitti manuali: ${report.summary.conflictsManual}`);
  console.log(`Incerti: ${report.summary.uncertain}`);
  console.log(`Senza prodotto Shopify collegato: ${report.summary.missingShopifyProduct}`);
  console.log(`Lookup eBay falliti: ${report.summary.ebayLookupFailed}`);
  console.log("");

  if (report.proposedFacets.length > 0) {
    console.log("Faccette proposte più frequenti:");
    for (const facet of report.proposedFacets.slice(0, 20)) {
      console.log(`- ${facet.label}: ${facet.value} (${facet.count})`);
    }
    console.log("");
  }

  printSample(report, "Applicabili", "applicable");
  printSample(report, "Conflitti manuali", "conflict_manual");
  printSample(report, "Incerti", "uncertain");
  printSample(report, "Lookup eBay falliti", "ebay_lookup_failed");
}

function printApplySummary(apply) {
  console.log("Apply Shopify:");
  if (!apply.requested) {
    console.log(`- non eseguito; prodotti applicabili pianificati: ${apply.planned}`);
  } else {
    console.log("- richiesto con conferma esplicita");
    console.log(`- applicati: ${apply.applied}`);
    console.log(`- falliti: ${apply.failed}`);
  }

  console.log(`- già corretti saltati: ${apply.skipped.alreadyCorrect}`);
  console.log(`- conflitti manuali saltati: ${apply.skipped.conflictsManual}`);
  console.log(`- incerti saltati: ${apply.skipped.uncertain}`);
  console.log(`- senza prodotto Shopify saltati: ${apply.skipped.missingShopifyProduct}`);
  console.log(`- lookup eBay falliti saltati: ${apply.skipped.ebayLookupFailed}`);

  if (apply.failures?.length > 0) {
    console.log("");
    console.log("Errori apply (campione):");
    for (const failure of apply.failures) {
      console.log(
        `- ItemID ${failure.ebayItemId}: ${failure.error} (${failure.shopifyProductGid})`,
      );
    }
  }

  console.log("");
}

function printSample(report, label, status) {
  const rows = report.rows.filter((row) => row.status === status).slice(0, 10);

  if (rows.length === 0) return;

  console.log(`${label} (campione):`);
  for (const row of rows) {
    const facets = row.proposedFacets.map((facet) => `${facet.label}=${facet.value}`).join(" · ");
    const reason = row.lookupFailureReason ? ` · ${row.lookupFailureReason}` : "";
    console.log(`- ItemID ${row.ebayItemId}: ${facets || "nessuna faccetta"}${reason}`);
  }
  console.log("");
}

function parseArgs(rawArgs) {
  const { values } = parseNodeArgs({
    args: rawArgs,
    options: {
      apply: { type: "boolean" },
      "confirm-apply": { type: "boolean" },
      help: { short: "h", type: "boolean" },
      json: { type: "boolean" },
      limit: { type: "string" },
      shop: { type: "string" },
      "snapshot-only": { type: "boolean" },
    },
  });

  return {
    apply: values.apply,
    confirmApply: values["confirm-apply"],
    help: values.help,
    json: values.json,
    limit:
      values.limit === undefined ? undefined : parsePositiveLimitOption(values.limit, "--limit"),
    shop: values.shop,
    snapshotOnly: values["snapshot-only"],
  };
}

function printUsage() {
  console.log(`Uso: npm run facets:backfill -- [--shop dominio.myshopify.com] [--limit N] [--json] [--snapshot-only] [--apply --confirm-apply]

Diagnostica/emergenza faccette: il backfill ordinario non passa da questo
script, ma dal runner incrementale SYNC_INCREMENTAL con payload facetOnly.
Questo comando analizza i mapping ACTIVE e calcola le cinque faccette storefront
SyncBay da snapshot eBay e, salvo --snapshot-only, da Trading API GetItem. Di
default non scrive prodotti Shopify e non modifica eBay, salvo refresh della
sessione offline Shopify e del token eBay cifrato se scaduti.

  --limit N         Analizza solo i primi N mapping.
  --snapshot-only   Non chiama eBay Trading API; usa solo snapshot e titolo.
  --apply           Applica su Shopify solo prodotti applicabili.
  --confirm-apply   Conferma obbligatoria per qualunque scrittura prodotto Shopify.`);
}

function hasScope(scopeText, requiredScope) {
  return String(scopeText)
    .split(",")
    .map((scope) => scope.trim())
    .includes(requiredScope);
}

function normalizeText(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const normalized = String(value).trim();

  return normalized.length > 0 ? normalized : null;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

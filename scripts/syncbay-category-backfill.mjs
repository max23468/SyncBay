#!/usr/bin/env node
import { parseArgs as parseNodeArgs } from "node:util";

import { mapWithConcurrency } from "../app/lib/map-with-concurrency.ts";
import {
  buildCategoryApplyPlan,
  buildCategoryBackfillReport,
} from "../app/lib/syncbay-category-backfill-report.ts";
import { getSyncBayCategorySourceFromMetafields } from "../app/lib/syncbay-shopify-product-metafields.ts";
import { resolveShopifyCategoryProposal } from "../app/lib/syncbay-shopify-category-mapping.ts";
import {
  asEbayTradingRecord as asRecord,
  getEbayTradingString as getString,
} from "../app/lib/syncbay-ebay-trading.ts";
import { getEbayTradingItem as getTradingItem } from "../app/services/ebay-trading-api.server.ts";
import { querySupabaseJson, sqlQuote } from "./supabase-cli-env.mjs";
import {
  ensureTokenEncryptionKey,
  getAccessToken,
  getShopifyAccessToken,
  loadDotEnv,
} from "./syncbay-ebay-cli.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";

const MAX_RUNTIME_PRODUCT_BATCH_SIZE = 20;
const GET_ITEM_CONCURRENCY = 4;
const APPLY_CONCURRENCY = 4;
const SHOPIFY_ADMIN_API_VERSION = "2026-07";
const APPLY_CATEGORY_MUTATION = `mutation SyncBayApplyCategory($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product {
      id
      productType
      category {
        id
        name
        fullName
      }
    }
    userErrors {
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
  console.error(`Dry-run categorie non riuscito: ${formatError(error)}`);
  process.exit(1);
});

async function main() {
  if (args.apply && !args.confirmApply) {
    throw new Error("Apply categorie bloccato: aggiungi --confirm-apply per scrivere su Shopify.");
  }

  if (!args.apply && args.confirmApply) {
    throw new Error("--confirm-apply richiede anche --apply.");
  }

  if (args.apply && args.repairCategoryConflicts && !args.confirmRepairCategoryConflicts) {
    throw new Error(
      "Riparazione conflitti categoria bloccata: aggiungi --confirm-repair-category-conflicts.",
    );
  }

  if (args.confirmRepairCategoryConflicts && !args.repairCategoryConflicts) {
    throw new Error(
      "--confirm-repair-category-conflicts richiede anche --repair-category-conflicts.",
    );
  }

  if (args.apply && args.forceCategoryConflicts && !args.confirmForceCategoryConflicts) {
    throw new Error(
      "Forzatura conflitti categoria bloccata: aggiungi --confirm-force-category-conflicts.",
    );
  }

  if (args.confirmForceCategoryConflicts && !args.forceCategoryConflicts) {
    throw new Error(
      "--confirm-force-category-conflicts richiede anche --force-category-conflicts.",
    );
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
      "Apply categorie bloccato: la sessione offline Shopify non espone write_products.",
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
  const { accessToken } = await getAccessToken(state.connection);
  const rows = await mapWithConcurrency(mappings, GET_ITEM_CONCURRENCY, async (mapping) =>
    buildReportRow({
      accessToken,
      connection: state.connection,
      mapping,
      shopifyProduct: shopifyProducts.get(mapping.shopifyProductGid) ?? null,
    }),
  );
  const report = buildCategoryBackfillReport({
    rows,
    shopDomain,
  });
  const sourceSummary = getCategorySourceSummary(rows);
  const applyPlan = buildCategoryApplyPlan(report, {
    forceCategoryConflicts: args.forceCategoryConflicts,
    includeCategoryConflicts: args.repairCategoryConflicts,
  });
  const applyResult = args.apply
    ? await applyCategoryPlan({
        accessToken: shopifyAccessToken,
        plan: applyPlan,
      })
    : null;
  const output = {
    ...report,
    analyzed: mappings.length,
    apply: applyResult ?? {
      planned: applyPlan.rows.length,
      forceCategoryConflicts: Boolean(args.forceCategoryConflicts),
      repairCategoryConflicts: Boolean(args.repairCategoryConflicts),
      requested: false,
      skipped: applyPlan.skipped,
    },
    activeMappingsTotal: allMappings.length,
    partial: Boolean(args.limit && args.limit < allMappings.length),
    sourceSummary,
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
  const snapshotSource = getSnapshotCategorySource(input.mapping);
  const metafieldSource = getMetafieldCategorySource(input.shopifyProduct);
  let source = mergeCategorySources(snapshotSource, metafieldSource);
  let categorySource = getCachedCategorySourceName(snapshotSource, metafieldSource);
  let lookupFailureReason = null;
  let lookupFailed = false;

  if (shouldRefreshFromTrading(source)) {
    try {
      const item = await getTradingItem({
        accessToken: input.accessToken,
        connection: input.connection,
        itemId: input.mapping.ebayItemId,
      });
      source = {
        ebayPrimaryCategoryId: getPrimaryCategoryId(item),
        ebayPrimaryCategoryName: getPrimaryCategoryName(item),
        ebayPrimaryCategoryPath: null,
        ebayStoreCategoryName: getStorefrontCategoryName(item),
        title: getString(item, "Title") ?? snapshotSource.title,
      };
      categorySource = "trading";
    } catch (error) {
      lookupFailureReason = formatError(error);
      lookupFailed = true;
      categorySource = "none";
    }
  }

  const proposal = resolveShopifyCategoryProposal({
    ebayPrimaryCategoryName: source.ebayPrimaryCategoryName,
    ebayPrimaryCategoryPath: source.ebayPrimaryCategoryPath,
    ebayStoreCategoryName: source.ebayStoreCategoryName,
    title: source.title,
  });

  return {
    ebayItemId: input.mapping.ebayItemId,
    categorySource,
    lookupFailureReason,
    lookupFailed,
    proposal,
    shopifyCategoryGid: normalizeText(input.shopifyProduct?.category?.id),
    shopifyProductGid: input.mapping.shopifyProductGid ?? null,
    shopifyProductType: normalizeText(input.shopifyProduct?.productType),
  };
}

function shouldRefreshFromTrading(source) {
  // Il refresh Trading serve solo quando manca la categoria primaria eBay.
  return !source.ebayPrimaryCategoryName?.trim();
}

function mergeCategorySources(snapshotSource, metafieldSource) {
  return {
    ebayPrimaryCategoryId:
      snapshotSource.ebayPrimaryCategoryId ?? metafieldSource?.ebayPrimaryCategoryId ?? null,
    ebayPrimaryCategoryName:
      snapshotSource.ebayPrimaryCategoryName ?? metafieldSource?.ebayPrimaryCategoryName ?? null,
    ebayPrimaryCategoryPath:
      snapshotSource.ebayPrimaryCategoryPath ?? metafieldSource?.ebayPrimaryCategoryPath ?? null,
    ebayStoreCategoryName:
      snapshotSource.ebayStoreCategoryName ??
      metafieldSource?.storeCategoryPath ??
      metafieldSource?.storeCategoryName ??
      null,
    title: snapshotSource.title,
  };
}

function getMetafieldCategorySource(shopifyProduct) {
  return getSyncBayCategorySourceFromMetafields(shopifyProduct?.metafields?.nodes);
}

function getCachedCategorySourceName(snapshotSource, metafieldSource) {
  if (!shouldRefreshFromTrading(snapshotSource)) return "snapshot";
  if (
    metafieldSource?.ebayPrimaryCategoryName ||
    metafieldSource?.storeCategoryName ||
    metafieldSource?.storeCategoryPath
  ) {
    return "shopify_metafields";
  }

  return "none";
}

function getSnapshotCategorySource(mapping) {
  const payload = asRecord(mapping.ebayPayload);

  return {
    ebayPrimaryCategoryId: normalizeText(payload?.ebayPrimaryCategoryId),
    ebayPrimaryCategoryName: normalizeText(payload?.ebayPrimaryCategoryName),
    ebayPrimaryCategoryPath: normalizeText(payload?.ebayPrimaryCategoryPath),
    ebayStoreCategoryName: normalizeText(payload?.storeCategoryName),
    title: normalizeText(mapping.ebayTitle),
  };
}

async function getBackfillState() {
  const { rows } = await querySupabaseJson(`
with shop_row as (
  select id, "defaultLocationGid"
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
    pm.sku,
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
  'defaultLocationGid', (select "defaultLocationGid" from shop_row),
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
          query: `query SyncBayCategoryBackfillProducts($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product {
      id
      productType
      category {
        id
        name
        fullName
      }
      metafields(first: 20, namespace: "syncbay") {
        nodes {
          key
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

async function applyCategoryPlan(input) {
  const results = await mapWithConcurrency(input.plan.rows, APPLY_CONCURRENCY, async (row) =>
    applyCategoryRow({
      accessToken: input.accessToken,
      row,
    }),
  );
  const failures = results.filter((result) => !result.ok);

  return {
    applied: results.length - failures.length,
    failed: failures.length,
    failures: failures.slice(0, 20),
    forceCategoryConflicts: Boolean(args.forceCategoryConflicts),
    planned: input.plan.rows.length,
    repairCategoryConflicts: Boolean(args.repairCategoryConflicts),
    requested: true,
    skipped: input.plan.skipped,
  };
}

async function applyCategoryRow(input) {
  const response = await fetch(
    `https://${shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`,
    {
      body: JSON.stringify({
        query: APPLY_CATEGORY_MUTATION,
        variables: {
          product: {
            category: input.row.shopifyCategoryGid,
            id: input.row.shopifyProductGid,
            productType: input.row.productType,
          },
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

  const userErrors = payload?.data?.productUpdate?.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      ebayItemId: input.row.ebayItemId,
      error: userErrors
        .map((error) => `${error.field?.join(".") ?? "product"}: ${error.message}`)
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

function getPrimaryCategoryId(item) {
  return getString(asRecord(item?.PrimaryCategory), "CategoryID");
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
  console.log(`Shop: ${report.shopDomain}`);
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
  if (report.sourceSummary) {
    console.log(
      `Sorgenti categorie: snapshot ${report.sourceSummary.snapshot}, metafield Shopify ${report.sourceSummary.shopifyMetafields}, eBay live ${report.sourceSummary.trading}, assenti ${report.sourceSummary.none}`,
    );
  }
  console.log("");

  if (report.proposedCategories.length > 0) {
    console.log("Categorie Shopify proposte:");
    for (const category of report.proposedCategories) {
      console.log(
        `- ${category.shopifyCategoryName}: ${category.count} (${category.shopifyCategoryGid})`,
      );
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
    console.log(`- non eseguito; righe applicabili pianificate: ${apply.planned}`);
  } else {
    console.log(`- richiesto con conferma esplicita`);
    console.log(`- applicati: ${apply.applied}`);
    console.log(`- falliti: ${apply.failed}`);
  }

  console.log(
    `- riparazione conflitti categoria: ${apply.repairCategoryConflicts ? "inclusa" : "non inclusa"}`,
  );
  console.log(
    `- forzatura conflitti categoria: ${apply.forceCategoryConflicts ? "inclusa" : "non inclusa"}`,
  );
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
    const proposal = row.proposal;
    const reason = row.lookupFailureReason ? ` · ${row.lookupFailureReason}` : "";
    console.log(
      `- ItemID ${row.ebayItemId}: ${proposal?.shopifyCategoryName ?? "nessuna categoria"} · ${proposal?.confidence ?? "n/a"}${reason}`,
    );
  }
  console.log("");
}

function getCategorySourceSummary(rows) {
  return rows.reduce(
    (summary, row) => {
      if (row.categorySource === "snapshot") summary.snapshot += 1;
      else if (row.categorySource === "shopify_metafields") {
        summary.shopifyMetafields += 1;
      } else if (row.categorySource === "trading") summary.trading += 1;
      else summary.none += 1;

      return summary;
    },
    { none: 0, shopifyMetafields: 0, snapshot: 0, trading: 0 },
  );
}

function parseArgs(rawArgs) {
  const { values } = parseNodeArgs({
    args: rawArgs,
    options: {
      apply: { type: "boolean" },
      "confirm-apply": { type: "boolean" },
      "confirm-force-category-conflicts": { type: "boolean" },
      "confirm-repair-category-conflicts": { type: "boolean" },
      "force-category-conflicts": { type: "boolean" },
      help: { short: "h", type: "boolean" },
      json: { type: "boolean" },
      limit: { type: "string" },
      "repair-category-conflicts": { type: "boolean" },
      shop: { type: "string" },
    },
  });
  const limit = Number.parseInt(values.limit ?? "", 10);

  return {
    apply: values.apply,
    confirmApply: values["confirm-apply"],
    confirmForceCategoryConflicts: values["confirm-force-category-conflicts"],
    confirmRepairCategoryConflicts: values["confirm-repair-category-conflicts"],
    forceCategoryConflicts: values["force-category-conflicts"],
    help: values.help,
    json: values.json,
    limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
    repairCategoryConflicts: values["repair-category-conflicts"],
    shop: values.shop,
  };
}

function printUsage() {
  console.log(`Uso: npm run categories:backfill -- [--shop dominio.myshopify.com] [--limit N] [--json] [--apply --confirm-apply] [--repair-category-conflicts --confirm-repair-category-conflicts] [--force-category-conflicts --confirm-force-category-conflicts]

Dry-run categorie: analizza i mapping ACTIVE, calcola la categoria Shopify
proposta da eBay e confronta la categoria Shopify attuale. Di default non
scrive prodotti Shopify e non modifica eBay. Può refreshare la sessione offline
Shopify e il token eBay cifrato se scaduti.

  --limit N         Analizza solo i primi N mapping.
  --apply           Applica su Shopify solo le righe applicabili.
  --confirm-apply   Conferma obbligatoria per qualunque scrittura prodotto Shopify.
  --repair-category-conflicts
                    Include nell'apply i conflitti noti del vecchio mapper.
  --confirm-repair-category-conflicts
                    Conferma obbligatoria per sovrascrivere quei conflitti.
  --force-category-conflicts
                    Include nell'apply tutti i conflitti categoria manuali.
  --confirm-force-category-conflicts
                    Conferma obbligatoria per sovrascrivere quei conflitti.`);
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

#!/usr/bin/env node
import fs from "node:fs";
import { parseArgs as parseNodeArgs } from "node:util";

import { mapWithConcurrency } from "../app/lib/map-with-concurrency.ts";
import {
  buildDescriptionBackfillApplyFile,
  buildDescriptionBackfillApplyPlan,
  buildDescriptionBackfillReport,
  buildDescriptionBackfillRow,
  buildDescriptionBackfillSnapshotPayload,
  filterDescriptionBackfillApplyFileRows,
} from "../app/lib/syncbay-description-backfill.ts";
import {
  buildDescriptionCleanupReportRow,
  cleanEbayDescriptionHtml,
} from "../app/lib/syncbay-description-cleanup.ts";
import { hashNullableText } from "../app/lib/syncbay-description-hash.ts";
import {
  buildGetSellerListRequest,
  buildTradingItemCache,
} from "../app/lib/syncbay-ebay-trading-bulk.ts";
import { parsePositiveLimitOption } from "../app/lib/syncbay-cli-args.ts";
import { querySupabaseJson, sqlQuote } from "./supabase-cli-env.mjs";
import {
  asRecord,
  ensureTokenEncryptionKey,
  getAccessToken,
  getShopifyAccessToken,
  getString,
  getTradingItem,
  loadDotEnv,
  tradingCall,
} from "./syncbay-ebay-cli.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";

const DEFAULT_MARKETPLACE_ID = "EBAY_IT";
const GET_ITEM_CONCURRENCY = 4;
const GET_SELLER_LIST_ENTRIES_PER_PAGE = 200;
// eBay requires the GetSellerList time range to stay below 120 days.
const GET_SELLER_LIST_WINDOW_DAYS = 119;
const APPLY_CONCURRENCY = 4;
const SHOPIFY_ADMIN_API_VERSION = "2026-07";
const APPLY_DESCRIPTION_MUTATION = `mutation SyncBayBackfillCleanDescription($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product {
      id
      descriptionHtml
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
if (process.env.SYNCBAY_SUPABASE_CWD) {
  loadDotEnv(`${process.env.SYNCBAY_SUPABASE_CWD}/.env`);
}

const shopDomain = resolveRequiredShopDomainOption({
  args,
  env: process.env,
});
const marketplaceId = args.marketplace ?? DEFAULT_MARKETPLACE_ID;

ensureTokenEncryptionKey();

await main().catch((error) => {
  console.error(`Backfill descrizioni non riuscito: ${formatError(error)}`);
  process.exit(1);
});

async function main() {
  if (args.applyPlan && (!args.apply || !args.confirmApply)) {
    throw new Error("--apply-plan richiede --apply --confirm-apply per scrivere su Shopify.");
  }

  if (args.apply && !args.confirmApply) {
    throw new Error(
      "Apply descrizioni bloccato: aggiungi --confirm-apply per scrivere su Shopify.",
    );
  }

  if (!args.apply && args.confirmApply) {
    throw new Error("--confirm-apply richiede anche --apply.");
  }

  const state = await getBackfillState();
  if (!args.applyPlan && !state.connection) {
    throw new Error(`Nessuna connessione eBay attiva per ${shopDomain}.`);
  }

  if (!state.shop) {
    throw new Error(`Shop ${shopDomain} non trovato.`);
  }

  if (
    args.apply &&
    state.shopifySession?.scope &&
    !hasScope(state.shopifySession.scope, "write_products")
  ) {
    throw new Error(
      "Apply descrizioni bloccato: la sessione offline Shopify non espone write_products.",
    );
  }

  if (args.applyPlan) {
    const applyFile = readDescriptionBackfillApplyFile(args.applyPlan);
    if (applyFile.shopDomain !== shopDomain) {
      throw new Error(
        `Apply plan per ${applyFile.shopDomain}, ma lo shop richiesto e' ${shopDomain}.`,
      );
    }

    const shopifyAccessToken = await getShopifyAccessToken(state.shopifySession, shopDomain);
    const shopifyProducts = await loadShopifyProducts({
      accessToken: shopifyAccessToken,
      productGids: applyFile.rows.map((row) => row.shopifyProductGid).filter(Boolean),
    });
    const guardedPlan = filterDescriptionBackfillApplyFileRows({
      currentMappingRows: new Map(
        (Array.isArray(state.mappings) ? state.mappings : []).map((mapping) => [
          mapping.mappingId,
          {
            openConflictFields: mapping.openConflictFields,
            shopifyProductGid: mapping.shopifyProductGid,
          },
        ]),
      ),
      currentShopifyDescriptionHashes: new Map(
        applyFile.rows
          .filter((row) => row.shopifyProductGid)
          .map((row) => [
            row.shopifyProductGid,
            shopifyProducts.has(row.shopifyProductGid)
              ? hashNullableText(
                  shopifyProducts.get(row.shopifyProductGid)?.descriptionHtml ?? null,
                )
              : undefined,
          ]),
      ),
      file: applyFile,
    });
    const report = buildDescriptionBackfillReport({
      rows: [...guardedPlan.rows, ...guardedPlan.skippedRows],
      shopDomain,
    });
    const applyResult = await applyDescriptionPlan({
      accessToken: shopifyAccessToken,
      plan: guardedPlan,
      shopId: state.shop.id,
    });
    const output = {
      ...report,
      activeMappingsTotal: applyFile.rows.length,
      analyzed: applyFile.rows.length,
      apply: applyResult,
      applyPlanFile: args.applyPlan,
      partial: false,
    };

    if (args.json) {
      console.log(JSON.stringify(sanitizeOutput(output), null, 2));
      if (applyResult.failed > 0) process.exitCode = 1;
      return;
    }

    printReport(output);
    printApplySummary(output.apply);
    if (applyResult.failed > 0) process.exitCode = 1;
    return;
  }

  const allMappings = Array.isArray(state.mappings) ? state.mappings : [];
  const mappings = args.limit ? allMappings.slice(0, args.limit) : allMappings;

  if (mappings.length === 0) {
    throw new Error("Nessun mapping ACTIVE/OUT_OF_STOCK da analizzare.");
  }

  const shopifyAccessToken = await getShopifyAccessToken(state.shopifySession, shopDomain);
  const shopifyProducts = await loadShopifyProducts({
    accessToken: shopifyAccessToken,
    productGids: mappings.map((row) => row.shopifyProductGid).filter(Boolean),
  });
  const { accessToken: ebayAccessToken } = await getAccessToken(state.connection);
  const tradingItemCache =
    args.ebaySource === "seller-list"
      ? await loadTradingSellerListItemCache({
          accessToken: ebayAccessToken,
          connection: state.connection,
          itemIds: mappings.map((mapping) => mapping.ebayItemId),
        })
      : null;
  const rows = await mapWithConcurrency(mappings, GET_ITEM_CONCURRENCY, async (mapping) =>
    buildReportRow({
      accessToken: ebayAccessToken,
      connection: state.connection,
      mapping,
      shopifyProduct: shopifyProducts.get(mapping.shopifyProductGid) ?? null,
      tradingItemCache,
    }),
  );
  const report = buildDescriptionBackfillReport({
    rows,
    shopDomain,
  });
  const applyPlan = buildDescriptionBackfillApplyPlan(report);
  if (args.writeApplyPlan) {
    fs.writeFileSync(
      args.writeApplyPlan,
      JSON.stringify(
        buildDescriptionBackfillApplyFile({
          generatedAt: new Date().toISOString(),
          report,
        }),
        null,
        2,
      ),
    );
  }
  const applyResult = args.apply
    ? await applyDescriptionPlan({
        accessToken: shopifyAccessToken,
        plan: applyPlan,
        shopId: state.shop.id,
      })
    : null;
  const output = {
    ...report,
    activeMappingsTotal: allMappings.length,
    analyzed: mappings.length,
    apply: applyResult ?? {
      planned: applyPlan.rows.length,
      requested: false,
      skipped: applyPlan.skipped,
    },
    applyPlanFile: args.writeApplyPlan ?? null,
    ebaySource: args.ebaySource ?? "get-item",
    partial: Boolean(args.limit && args.limit < allMappings.length),
  };

  if (args.json) {
    console.log(JSON.stringify(sanitizeOutput(output), null, 2));
    if (applyResult?.failed > 0) process.exitCode = 1;
    return;
  }

  printReport(output);
  printApplySummary(output.apply);
  if (applyResult?.failed > 0) process.exitCode = 1;
}

async function buildReportRow(input) {
  const openConflictFields = normalizeStringArray(input.mapping.openConflictFields);
  const baseInput = {
    currentShopifyDescriptionHtml: input.shopifyProduct?.descriptionHtml ?? null,
    currentShopifyDescriptionHash: hashNullableText(input.shopifyProduct?.descriptionHtml ?? null),
    ebayItemId: input.mapping.ebayItemId,
    mappingId: input.mapping.mappingId,
    openConflictFields,
    shopifyLookupFailed: Boolean(input.mapping.shopifyProductGid && !input.shopifyProduct),
    shopifyProductGid: input.mapping.shopifyProductGid ?? null,
    latestSyncBayDescriptionHash: input.mapping.latestSyncBayDescriptionHash ?? null,
    title: input.mapping.title ?? input.shopifyProduct?.title ?? null,
  };

  if (
    !baseInput.shopifyProductGid ||
    baseInput.openConflictFields.length > 0 ||
    baseInput.shopifyLookupFailed
  ) {
    return buildRowFromDescriptions({
      ...baseInput,
      ebayDescriptionHtml: null,
    });
  }

  try {
    const cachedItem = input.tradingItemCache?.get(input.mapping.ebayItemId);
    const item =
      cachedItem ??
      (await getTradingItem({
        accessToken: input.accessToken,
        connection: input.connection,
        includeItemSpecifics: true,
        itemId: input.mapping.ebayItemId,
      }));

    return buildRowFromDescriptions({
      ...baseInput,
      ebayDescriptionHtml:
        "descriptionHtml" in item ? item.descriptionHtml : getString(item, "Description"),
      title:
        ("title" in item ? item.title : getString(item, "Title")) ??
        input.mapping.title ??
        input.shopifyProduct?.title ??
        null,
    });
  } catch (error) {
    return buildRowFromDescriptions({
      ...baseInput,
      ebayDescriptionHtml: null,
      ebayLookupFailed: true,
      ebayLookupFailureReason: formatError(error),
    });
  }
}

function readDescriptionBackfillApplyFile(path) {
  const parsed = JSON.parse(fs.readFileSync(path, "utf8"));

  if (parsed?.version !== 1 || !Array.isArray(parsed.rows)) {
    throw new Error("Apply plan descrizioni non valido.");
  }

  return parsed;
}

function buildRowFromDescriptions(input) {
  const cleanup = cleanEbayDescriptionHtml(input.ebayDescriptionHtml);
  const reportRow = buildDescriptionCleanupReportRow({
    descriptionHtml: input.ebayDescriptionHtml,
    itemId: input.ebayItemId,
    title: input.title,
  });

  return buildDescriptionBackfillRow({
    ...input,
    cleanedDescriptionHash: hashNullableText(cleanup.html),
    cleanedDescriptionHtml: cleanup.html,
    cleanedTextExcerpt: reportRow.cleanedTextExcerpt,
    currentShopifyDescriptionHash: input.currentShopifyDescriptionHash,
    descriptionMode: cleanup.mode,
    descriptionRemovedPercent: reportRow.removedPercent,
    descriptionWasChanged: cleanup.wasChanged,
    originalDescriptionHash: hashNullableText(input.ebayDescriptionHtml),
    originalTextExcerpt: reportRow.rawTextExcerpt,
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
  where ec."marketplaceId" = ${sqlQuote(marketplaceId)}
    and ec.status = 'CONNECTED'
  limit 1
),
mappings as (
  select
    pm.id as "mappingId",
    pm."ebayItemId",
    pm."shopifyProductGid",
    pm.status,
    coalesce(ps.title, pm."ebayItemId") as title,
    description_baseline."descriptionHash" as "latestSyncBayDescriptionHash",
    coalesce(
      array_remove(array_agg(distinct sc.field) filter (where sc.id is not null), null),
      array[]::text[]
    ) as "openConflictFields"
  from "ProductMapping" pm
  join shop_row s on s.id = pm."shopId"
  left join "SyncConflict" sc
    on sc."mappingId" = pm.id
   and sc.status = 'OPEN'
  left join lateral (
    select title
    from "ProductSnapshot" ps
    where ps."mappingId" = pm.id
      and ps.title is not null
    order by ps."capturedAt" desc
    limit 1
  ) ps on true
  left join lateral (
    select "descriptionHash"
    from "ProductSnapshot" ps
    where ps."mappingId" = pm.id
      and ps.source = 'SYNCBAY'
      and ps."descriptionHash" is not null
    order by ps."capturedAt" desc
    limit 1
  ) description_baseline on true
  where pm."marketplaceId" = ${sqlQuote(marketplaceId)}
    and pm.status in ('ACTIVE', 'OUT_OF_STOCK')
  group by pm.id, pm."ebayItemId", pm."shopifyProductGid", pm.status, ps.title, description_baseline."descriptionHash"
  order by pm."updatedAt" desc
)
select jsonb_build_object(
  'shop', (select to_jsonb(shop_row) from shop_row),
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

  for (const batch of chunkArray(uniqueProductGids, 20)) {
    const response = await fetch(
      `https://${shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`,
      {
        body: JSON.stringify({
          query: `query SyncBayDescriptionBackfillProducts($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product {
      id
      descriptionHtml
      title
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

async function applyDescriptionPlan(input) {
  const results = await mapWithConcurrency(input.plan.rows, APPLY_CONCURRENCY, async (row) =>
    applyDescriptionRow({
      accessToken: input.accessToken,
      row,
      shopId: input.shopId,
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

async function applyDescriptionRow(input) {
  const response = await fetch(
    `https://${shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`,
    {
      body: JSON.stringify({
        query: APPLY_DESCRIPTION_MUTATION,
        variables: {
          product: {
            descriptionHtml: input.row.cleanedDescriptionHtml,
            id: input.row.shopifyProductGid,
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

  const product = payload?.data?.productUpdate?.product;
  if (!product?.id) {
    return {
      ebayItemId: input.row.ebayItemId,
      error: "Shopify non ha restituito il prodotto aggiornato.",
      ok: false,
      shopifyProductGid: input.row.shopifyProductGid,
    };
  }

  await recordDescriptionBackfillSnapshot({
    row: input.row,
    shopId: input.shopId,
    shopifyDescriptionHtml: product.descriptionHtml ?? null,
  });

  return {
    ebayItemId: input.row.ebayItemId,
    ok: true,
    shopifyProductGid: input.row.shopifyProductGid,
  };
}

async function recordDescriptionBackfillSnapshot(input) {
  const capturedAt = new Date().toISOString();
  const descriptionHash = hashNullableText(input.shopifyDescriptionHtml);
  const payload = buildDescriptionBackfillSnapshotPayload({
    cleanedDescriptionHash: input.row.cleanedDescriptionHash,
    descriptionMode: input.row.descriptionMode,
    descriptionRemovedPercent: input.row.descriptionRemovedPercent,
    originalDescriptionHash: input.row.originalDescriptionHash,
  });

  await querySupabaseJson(`
with latest_baseline as (
  select
    sku,
    title,
    currency,
    quantity,
    "productStatus",
    "shopifyVariantGid"
  from "ProductSnapshot"
  where "mappingId" = ${sqlQuote(input.row.mappingId)}
    and (
      sku is not null
      or title is not null
      or currency is not null
      or quantity is not null
      or "productStatus" is not null
      or "shopifyVariantGid" is not null
    )
  order by "capturedAt" desc
  limit 1
),
inserted_snapshot as (
  insert into "ProductSnapshot" (
    id,
    "shopId",
    "mappingId",
    source,
    "ebayItemId",
    "shopifyProductGid",
    "shopifyVariantGid",
    sku,
    title,
    currency,
    quantity,
    "productStatus",
    "descriptionHash",
    payload,
    "capturedAt"
  )
  select
    gen_random_uuid()::text,
    ${sqlQuote(input.shopId)},
    ${sqlQuote(input.row.mappingId)},
    'SYNCBAY',
    ${sqlQuote(input.row.ebayItemId)},
    ${sqlQuote(input.row.shopifyProductGid)},
    latest_baseline."shopifyVariantGid",
    latest_baseline.sku,
    coalesce(latest_baseline.title, ${sqlQuote(input.row.title)}),
    latest_baseline.currency,
    latest_baseline.quantity,
    latest_baseline."productStatus",
    ${sqlQuote(descriptionHash)},
    ${sqlQuote(JSON.stringify(payload))}::jsonb,
    ${sqlQuote(capturedAt)}::timestamp
  from (select 1) seed
  left join latest_baseline on true
  returning id
),
updated_mapping as (
  update "ProductMapping"
  set "updatedAt" = now()
  where id = ${sqlQuote(input.row.mappingId)}
  returning id
)
select jsonb_build_object(
  'snapshotId', (select id from inserted_snapshot),
  'mappingId', (select id from updated_mapping)
) as payload;
`);
}

async function loadTradingSellerListItemCache(input) {
  const targetItemIds = new Set(input.itemIds.filter(Boolean));
  const foundItems = new Map();
  const windowStart = new Date();
  const windowEnd = new Date(
    windowStart.getTime() + GET_SELLER_LIST_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  let pageNumber = 1;
  let totalPages = null;

  while (totalPages === null || pageNumber <= totalPages) {
    if (foundItems.size >= targetItemIds.size) break;

    const body = await getTradingSellerListPage({
      accessToken: input.accessToken,
      connection: input.connection,
      pageNumber,
      windowEnd,
      windowStart,
    });
    const pageItems = getTradingItems(asRecord(body));
    const pageCache = buildTradingItemCache(pageItems);

    for (const [itemId, item] of pageCache) {
      if (targetItemIds.has(itemId) && !foundItems.has(itemId)) {
        foundItems.set(itemId, item);
      }
    }

    totalPages ??= getTotalPages(body);
    if (pageItems.length === 0) break;

    pageNumber += 1;
  }

  return foundItems;
}

async function getTradingSellerListPage(input) {
  return (
    (await tradingCall({
      accessToken: input.accessToken,
      callName: "GetSellerList",
      connection: input.connection,
      requestXml: buildGetSellerListRequest({
        entriesPerPage: GET_SELLER_LIST_ENTRIES_PER_PAGE,
        pageNumber: input.pageNumber,
        windowEnd: input.windowEnd,
        windowStart: input.windowStart,
      }),
    })) ?? {}
  );
}

function printReport(report) {
  console.log(`Shop: ${report.shopDomain}`);
  console.log(`Marketplace: ${marketplaceId}`);
  console.log(`Mapping ACTIVE/OUT_OF_STOCK totali: ${report.activeMappingsTotal}`);
  console.log(
    `Analizzati: ${report.analyzed}${report.partial ? " (parziale, usa senza --limit per la lista completa)" : ""}`,
  );
  console.log(`Applicabili: ${report.summary.applicable}`);
  console.log(`Gia' corretti: ${report.summary.alreadyCorrect}`);
  console.log(`Cleaner invariato: ${report.summary.cleanerUnchanged}`);
  console.log(`Conflitti aperti saltati: ${report.summary.conflictSkipped}`);
  console.log(`Senza prodotto Shopify collegato: ${report.summary.missingShopifyProduct}`);
  console.log(`Lookup Shopify falliti: ${report.summary.shopifyLookupFailed}`);
  console.log(`Lookup eBay falliti: ${report.summary.ebayLookupFailed}`);
  console.log(`Descrizione eBay assente: ${report.summary.ebayDescriptionMissing}`);
  console.log(`Descrizione pulita vuota: ${report.summary.emptyCleanedDescription}`);
  console.log("");

  printSample(report, "Applicabili", "applicable");
  printSample(report, "Gia' corretti", "already_correct");
  printSample(report, "Conflitti aperti", "conflict_skipped");
  printSample(report, "Lookup eBay falliti", "ebay_lookup_failed");
}

function printApplySummary(apply) {
  console.log("Apply Shopify:");
  if (!apply.requested) {
    console.log(`- non eseguito; righe applicabili pianificate: ${apply.planned}`);
  } else {
    console.log("- richiesto con conferma esplicita");
    console.log(`- applicati: ${apply.applied}`);
    console.log(`- falliti: ${apply.failed}`);
  }

  console.log(`- gia' corretti saltati: ${apply.skipped.alreadyCorrect}`);
  console.log(`- cleaner invariato saltati: ${apply.skipped.cleanerUnchanged}`);
  console.log(`- conflitti aperti saltati: ${apply.skipped.conflictSkipped}`);
  console.log(`- senza prodotto Shopify saltati: ${apply.skipped.missingShopifyProduct}`);
  console.log(`- lookup Shopify falliti saltati: ${apply.skipped.shopifyLookupFailed}`);
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
    const detail =
      row.status === "applicable" ? `${row.descriptionRemovedPercent}% rimosso` : row.reason;
    const lookup = row.ebayLookupFailureReason ? ` · ${row.ebayLookupFailureReason}` : "";
    console.log(`- ItemID ${row.ebayItemId}: ${row.title} · ${detail}${lookup}`);
    if (row.status === "applicable") {
      console.log(`  Pulita: ${row.cleanedTextExcerpt || "vuota"}`);
    }
  }
  console.log("");
}

function sanitizeOutput(output) {
  return {
    ...output,
    rows: output.rows.map((row) => ({
      cleanedDescriptionHash: row.cleanedDescriptionHash,
      cleanedTextExcerpt: row.cleanedTextExcerpt,
      currentShopifyDescriptionHash: row.currentShopifyDescriptionHash,
      descriptionMode: row.descriptionMode,
      descriptionRemovedPercent: row.descriptionRemovedPercent,
      descriptionWasChanged: row.descriptionWasChanged,
      ebayItemId: row.ebayItemId,
      ebayLookupFailureReason: row.ebayLookupFailureReason,
      mappingId: row.mappingId,
      openConflictFields: row.openConflictFields,
      originalTextExcerpt: row.originalTextExcerpt,
      reason: row.reason,
      shopifyProductGid: row.shopifyProductGid,
      status: row.status,
      title: row.title,
    })),
  };
}

function parseArgs(rawArgs) {
  const { values } = parseNodeArgs({
    args: rawArgs,
    options: {
      apply: { type: "boolean" },
      "apply-plan": { type: "string" },
      "confirm-apply": { type: "boolean" },
      "ebay-source": { type: "string" },
      help: { short: "h", type: "boolean" },
      json: { type: "boolean" },
      limit: { type: "string" },
      marketplace: { type: "string" },
      shop: { type: "string" },
      "write-apply-plan": { type: "string" },
    },
  });

  if (
    values["ebay-source"] !== undefined &&
    !["get-item", "seller-list"].includes(values["ebay-source"])
  ) {
    throw new Error("--ebay-source supporta solo get-item o seller-list.");
  }

  return {
    apply: values.apply,
    applyPlan: values["apply-plan"],
    confirmApply: values["confirm-apply"],
    ebaySource: values["ebay-source"],
    help: values.help,
    json: values.json,
    limit:
      values.limit === undefined ? undefined : parsePositiveLimitOption(values.limit, "--limit"),
    marketplace: values.marketplace,
    shop: values.shop,
    writeApplyPlan: values["write-apply-plan"],
  };
}

function printUsage() {
  console.log(`Uso: npm run descriptions:backfill-cleanup -- [--shop dominio.myshopify.com] [--marketplace EBAY_IT] [--limit N] [--json] [--apply --confirm-apply] [--write-apply-plan file.json] [--apply-plan file.json] [--ebay-source get-item|seller-list]

Dry-run predefinito. Analizza prodotti ACTIVE/OUT_OF_STOCK collegati, legge la
descrizione eBay corrente da Trading API, calcola la versione pulita e pianifica
l'aggiornamento Shopify solo per prodotti senza conflitti aperti. Non modifica
eBay. Con --json non stampa HTML completo delle descrizioni.

  --limit N         Analizza solo i primi N mapping.
  --write-apply-plan file.json
                    Scrive un piano locale con HTML pulito completo per apply
                    successivo senza nuove letture eBay; non committare il file.
  --apply-plan file.json
                    Applica un piano scritto in precedenza, rileggendo solo
                    Shopify per bloccare modifiche manuali successive.
  --ebay-source seller-list
                    Prova a leggere descrizioni in bulk via GetSellerList e usa
                    GetItem solo per i listing non trovati nel bulk.
  --apply           Applica su Shopify solo le righe applicabili.
  --confirm-apply   Conferma obbligatoria per qualunque scrittura prodotto Shopify.`);
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function hasScope(scopeText, requiredScope) {
  return String(scopeText)
    .split(",")
    .map((scope) => scope.trim())
    .includes(requiredScope);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];

  return [value];
}

function getTradingItems(container) {
  const itemArray = asRecord(container?.ItemArray);

  return asArray(itemArray?.Item).flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

function getTotalPages(container) {
  const total = Number(getString(asRecord(container?.PaginationResult), "TotalNumberOfPages"));

  return Number.isInteger(total) && total > 0 ? total : null;
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

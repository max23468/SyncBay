#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

import { XMLParser } from "fast-xml-parser";

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
import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";
import { selectTokenEncryptionKey } from "./syncbay-token-key-source.mjs";

const DEFAULT_MARKETPLACE_ID = "EBAY_IT";
const GET_ITEM_CONCURRENCY = 4;
const GET_SELLER_LIST_ENTRIES_PER_PAGE = 200;
// eBay requires the GetSellerList time range to stay below 120 days.
const GET_SELLER_LIST_WINDOW_DAYS = 119;
const APPLY_CONCURRENCY = 4;
const SHOPIFY_ADMIN_API_VERSION = "2026-07";
const TOKEN_ENCRYPTION_KEYCHAIN_SERVICE = "syncbay-token-encryption-key";
const TRADING_API_COMPATIBILITY_LEVEL = "1453";
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

const supabaseEnv = {
  ...process.env,
  ...(await getSupabaseCliEnv()),
  SUPABASE_TELEMETRY_DISABLED: "1",
};
const xmlParser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  removeNSPrefix: true,
  textNodeName: "#text",
  trimValues: true,
});

await main().catch((error) => {
  console.error(`Backfill descrizioni non riuscito: ${formatError(error)}`);
  process.exit(1);
});

async function main() {
  if (args.applyPlan && (!args.apply || !args.confirmApply)) {
    throw new Error(
      "--apply-plan richiede --apply --confirm-apply per scrivere su Shopify.",
    );
  }

  if (args.apply && !args.confirmApply) {
    throw new Error(
      "Apply descrizioni bloccato: aggiungi --confirm-apply per scrivere su Shopify.",
    );
  }

  if (!args.apply && args.confirmApply) {
    throw new Error("--confirm-apply richiede anche --apply.");
  }

  const state = getBackfillState();
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

    const shopifyAccessToken = await getShopifyAccessToken(state.shopifySession);
    const shopifyProducts = await loadShopifyProducts({
      accessToken: shopifyAccessToken,
      productGids: applyFile.rows
        .map((row) => row.shopifyProductGid)
        .filter(Boolean),
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
                  shopifyProducts.get(row.shopifyProductGid)?.descriptionHtml ??
                    null,
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

  const shopifyAccessToken = await getShopifyAccessToken(state.shopifySession);
  const shopifyProducts = await loadShopifyProducts({
    accessToken: shopifyAccessToken,
    productGids: mappings.map((row) => row.shopifyProductGid).filter(Boolean),
  });
  const { accessToken: ebayAccessToken } = await getAccessToken(
    state.connection,
  );
  const tradingItemCache =
    args.ebaySource === "seller-list"
      ? await loadTradingSellerListItemCache({
          accessToken: ebayAccessToken,
          connection: state.connection,
          itemIds: mappings.map((mapping) => mapping.ebayItemId),
        })
      : null;
  const rows = await mapWithConcurrency(
    mappings,
    GET_ITEM_CONCURRENCY,
    async (mapping) =>
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
  const openConflictFields = normalizeStringArray(
    input.mapping.openConflictFields,
  );
  const baseInput = {
    currentShopifyDescriptionHtml: input.shopifyProduct?.descriptionHtml ?? null,
    currentShopifyDescriptionHash: hashNullableText(
      input.shopifyProduct?.descriptionHtml ?? null,
    ),
    ebayItemId: input.mapping.ebayItemId,
    mappingId: input.mapping.mappingId,
    openConflictFields,
    shopifyLookupFailed: Boolean(
      input.mapping.shopifyProductGid && !input.shopifyProduct,
    ),
    shopifyProductGid: input.mapping.shopifyProductGid ?? null,
    latestSyncBayDescriptionHash:
      input.mapping.latestSyncBayDescriptionHash ?? null,
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

function getBackfillState() {
  const rows = querySupabaseJson(`
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
      throw new Error(
        `Shopify Admin GraphQL non disponibile (HTTP ${response.status}).`,
      );
    }

    for (const product of payload?.data?.nodes ?? []) {
      if (product?.id) products.set(product.id, product);
    }
  }

  return products;
}

async function applyDescriptionPlan(input) {
  const results = await mapWithConcurrency(
    input.plan.rows,
    APPLY_CONCURRENCY,
    async (row) =>
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

  querySupabaseJson(`
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

async function getTradingItem(input) {
  const response = await fetch(getTradingBaseUrl(input.connection.environment), {
    body: `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Version>${TRADING_API_COMPATIBILITY_LEVEL}</Version>
  <DetailLevel>ReturnAll</DetailLevel>
  <ErrorLanguage>it_IT</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <IncludeItemSpecifics>true</IncludeItemSpecifics>
  <ItemID>${escapeXml(input.itemId)}</ItemID>
</GetItemRequest>`,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "X-EBAY-API-CALL-NAME": "GetItem",
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_API_COMPATIBILITY_LEVEL,
      "X-EBAY-API-IAF-TOKEN": input.accessToken,
      "X-EBAY-API-SITEID": getTradingSiteId(input.connection.marketplaceId),
    },
    method: "POST",
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`eBay Trading API HTTP ${response.status}.`);
  }

  const body = asRecord(
    asRecord(xmlParser.parse(responseText))?.GetItemResponse,
  );
  const ack = getString(body, "Ack");
  if (ack && !["Success", "Warning"].includes(ack)) {
    const errors = asRecord(body?.Errors);
    throw new Error(
      getString(errors, "LongMessage") ??
        getString(errors, "ShortMessage") ??
        "eBay GetItem non riuscita.",
    );
  }

  return asRecord(body?.Item) ?? {};
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
  const response = await fetch(getTradingBaseUrl(input.connection.environment), {
    body: buildGetSellerListRequest({
      entriesPerPage: GET_SELLER_LIST_ENTRIES_PER_PAGE,
      pageNumber: input.pageNumber,
      windowEnd: input.windowEnd,
      windowStart: input.windowStart,
    }),
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "X-EBAY-API-CALL-NAME": "GetSellerList",
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_API_COMPATIBILITY_LEVEL,
      "X-EBAY-API-IAF-TOKEN": input.accessToken,
      "X-EBAY-API-SITEID": getTradingSiteId(input.connection.marketplaceId),
    },
    method: "POST",
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`eBay Trading API GetSellerList HTTP ${response.status}.`);
  }

  const body = asRecord(
    asRecord(xmlParser.parse(responseText))?.GetSellerListResponse,
  );
  const ack = getString(body, "Ack");
  if (ack && !["Success", "Warning"].includes(ack)) {
    const errors = asRecord(body?.Errors);
    throw new Error(
      getString(errors, "LongMessage") ??
        getString(errors, "ShortMessage") ??
        "eBay GetSellerList non riuscita.",
    );
  }

  return body ?? {};
}

async function getShopifyAccessToken(session) {
  if (!session?.accessToken) {
    throw new Error(`Sessione offline Shopify non disponibile per ${shopDomain}.`);
  }

  const expiresAt = session.expires ? new Date(session.expires) : null;
  if (!expiresAt || expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return session.accessToken;
  }

  if (!session.refreshToken) {
    throw new Error(
      "Sessione offline Shopify scaduta senza refresh token: riapri l'app Shopify.",
    );
  }

  const refreshTokenExpiresAt = session.refreshTokenExpires
    ? new Date(session.refreshTokenExpires)
    : null;
  if (refreshTokenExpiresAt && refreshTokenExpiresAt.getTime() <= Date.now()) {
    throw new Error(
      "Refresh token Shopify offline scaduto: riapri l'app Shopify.",
    );
  }

  const response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    body: JSON.stringify({
      client_id: requiredEnv("SHOPIFY_API_KEY"),
      client_secret: requiredEnv("SHOPIFY_API_SECRET"),
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const json = await response.json().catch(() => null);

  if (!response.ok || !json?.access_token) {
    throw new Error(
      `Refresh token Shopify offline non riuscito (HTTP ${response.status}).`,
    );
  }

  const expiresAtNext = new Date(
    Date.now() + Number(json.expires_in ?? 3600) * 1000,
  );
  const refreshTokenExpiresAtNext = json.refresh_token_expires_in
    ? new Date(Date.now() + Number(json.refresh_token_expires_in) * 1000)
    : null;

  querySupabaseJson(`
update "Session"
set "accessToken" = ${sqlQuote(json.access_token)},
    expires = ${sqlQuote(expiresAtNext.toISOString())}::timestamp,
    "refreshToken" = coalesce(${sqlQuote(json.refresh_token ?? null)}, "refreshToken"),
    "refreshTokenExpires" = coalesce(${sqlQuote(refreshTokenExpiresAtNext?.toISOString() ?? null)}::timestamp, "refreshTokenExpires"),
    scope = coalesce(${sqlQuote(json.scope ?? null)}, scope)
where id = ${sqlQuote(session.id)}
returning id;
`);

  return json.access_token;
}

async function getAccessToken(connection) {
  const expiresAt = connection.tokenExpiresAt
    ? new Date(connection.tokenExpiresAt)
    : null;

  if (
    connection.encryptedAccessToken &&
    expiresAt &&
    expiresAt.getTime() > Date.now() + 5 * 60 * 1000
  ) {
    return { accessToken: decryptSecret(connection.encryptedAccessToken) };
  }

  if (!connection.encryptedRefreshToken) {
    throw new Error("Refresh token eBay assente.");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: decryptSecret(connection.encryptedRefreshToken),
  });
  const scopes = connection.scopes?.trim() || process.env.EBAY_SCOPES?.trim();
  if (scopes) body.set("scope", scopes);

  const response = await fetch(getTokenUrl(connection.environment), {
    body,
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${requiredEnv("EBAY_CLIENT_ID")}:${requiredEnv("EBAY_CLIENT_SECRET")}`,
        "utf8",
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const json = await response.json();

  if (!response.ok || !json.access_token) {
    throw new Error(
      json.error_description ?? json.error ?? "Refresh token eBay non riuscito.",
    );
  }

  const tokenExpiresAt = new Date(
    Date.now() + Number(json.expires_in ?? 7200) * 1000,
  );

  querySupabaseJson(`
update "EbayConnection"
set "encryptedAccessToken" = ${sqlQuote(encryptSecret(json.access_token))},
    "lastRefreshAt" = now(),
    "tokenExpiresAt" = ${sqlQuote(tokenExpiresAt.toISOString())}::timestamp,
    "scopes" = coalesce(${sqlQuote(json.scope ?? null)}, "scopes"),
    "updatedAt" = now()
where id = ${sqlQuote(connection.id)}
returning id;
`);

  return { accessToken: json.access_token };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );

  return results;
}

function querySupabaseJson(sql) {
  const result = spawnSync(
    "npx",
    ["supabase", "db", "query", "--linked", "--output", "json", sql],
    {
      cwd: process.env.SYNCBAY_SUPABASE_CWD ?? process.cwd(),
      encoding: "utf8",
      env: supabaseEnv,
      maxBuffer: 20 * 1024 * 1024,
    },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }

  const parsed = JSON.parse(result.stdout);
  const rows = Array.isArray(parsed) ? parsed : parsed.rows;
  if (!Array.isArray(rows)) {
    throw new Error("Output Supabase inatteso: rows non e' un array JSON.");
  }

  return rows;
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
  console.log(
    `Senza prodotto Shopify collegato: ${report.summary.missingShopifyProduct}`,
  );
  console.log(`Lookup Shopify falliti: ${report.summary.shopifyLookupFailed}`);
  console.log(`Lookup eBay falliti: ${report.summary.ebayLookupFailed}`);
  console.log(
    `Descrizione eBay assente: ${report.summary.ebayDescriptionMissing}`,
  );
  console.log(
    `Descrizione pulita vuota: ${report.summary.emptyCleanedDescription}`,
  );
  console.log("");

  printSample(report, "Applicabili", "applicable");
  printSample(report, "Gia' corretti", "already_correct");
  printSample(report, "Conflitti aperti", "conflict_skipped");
  printSample(report, "Lookup eBay falliti", "ebay_lookup_failed");
}

function printApplySummary(apply) {
  console.log("Apply Shopify:");
  if (!apply.requested) {
    console.log(
      `- non eseguito; righe applicabili pianificate: ${apply.planned}`,
    );
  } else {
    console.log("- richiesto con conferma esplicita");
    console.log(`- applicati: ${apply.applied}`);
    console.log(`- falliti: ${apply.failed}`);
  }

  console.log(`- gia' corretti saltati: ${apply.skipped.alreadyCorrect}`);
  console.log(`- cleaner invariato saltati: ${apply.skipped.cleanerUnchanged}`);
  console.log(`- conflitti aperti saltati: ${apply.skipped.conflictSkipped}`);
  console.log(
    `- senza prodotto Shopify saltati: ${apply.skipped.missingShopifyProduct}`,
  );
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
      row.status === "applicable"
        ? `${row.descriptionRemovedPercent}% rimosso`
        : row.reason;
    const lookup = row.ebayLookupFailureReason
      ? ` · ${row.ebayLookupFailureReason}`
      : "";
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
  const parsed = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--apply") {
      parsed.apply = true;
      continue;
    }

    if (arg === "--confirm-apply") {
      parsed.confirmApply = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--shop") {
      parsed.shop = rawArgs[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--marketplace") {
      parsed.marketplace = rawArgs[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--limit") {
      parsed.limit = parsePositiveLimitOption(rawArgs[index + 1], "--limit");
      index += 1;
      continue;
    }

    if (arg === "--write-apply-plan") {
      parsed.writeApplyPlan = rawArgs[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--apply-plan") {
      parsed.applyPlan = rawArgs[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--ebay-source") {
      const source = rawArgs[index + 1];
      if (!["get-item", "seller-list"].includes(source)) {
        throw new Error("--ebay-source supporta solo get-item o seller-list.");
      }

      parsed.ebaySource = source;
      index += 1;
      continue;
    }

    throw new Error(`Argomento non supportato: ${arg}`);
  }

  return parsed;
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

function decryptSecret(secret) {
  const [version, encodedIv, encodedAuthTag, encodedCiphertext] =
    secret.split(".");
  if (version !== "v1" || !encodedIv || !encodedAuthTag || !encodedCiphertext) {
    throw new Error("Formato segreto cifrato non valido.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getTokenKey(),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encodedAuthTag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getTokenKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function getTokenKey() {
  return crypto
    .createHash("sha256")
    .update(requiredEnv("TOKEN_ENCRYPTION_KEY"))
    .digest();
}

function ensureTokenEncryptionKey() {
  const selected = selectTokenEncryptionKey({
    envValue: process.env.TOKEN_ENCRYPTION_KEY,
    keychainValue: readKeychainSecret(TOKEN_ENCRYPTION_KEYCHAIN_SERVICE),
  });

  if (selected.value) {
    process.env.TOKEN_ENCRYPTION_KEY = selected.value;
    return;
  }

  throw new Error(
    `TOKEN_ENCRYPTION_KEY non configurata e segreto Portachiavi mancante: ${TOKEN_ENCRYPTION_KEYCHAIN_SERVICE}.`,
  );
}

function readKeychainSecret(service) {
  if (process.platform !== "darwin") return null;

  const result = spawnSync(
    "security",
    ["find-generic-password", "-s", service, "-w"],
    { encoding: "utf8" },
  );

  if (result.status !== 0) return null;

  return result.stdout.replace(/\r?\n$/, "");
}

function loadDotEnv(path) {
  if (!fs.existsSync(path)) return;

  for (const rawLine of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] ??= value;
  }
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string")
    : [];
}

function hasScope(scopeText, requiredScope) {
  return String(scopeText)
    .split(",")
    .map((scope) => scope.trim())
    .includes(requiredScope);
}

function getTokenUrl(environment) {
  return environment === "production"
    ? "https://api.ebay.com/identity/v1/oauth2/token"
    : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";
}

function getTradingBaseUrl(environment) {
  return environment === "production"
    ? "https://api.ebay.com/ws/api.dll"
    : "https://api.sandbox.ebay.com/ws/api.dll";
}

function getTradingSiteId(value) {
  if (value === "EBAY_IT") return "101";

  throw new Error(`Marketplace Trading API non supportato: ${value}.`);
}

function requiredEnv(key) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} non configurata.`);

  return value;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];

  return [value];
}

function getString(record, key) {
  const value = asRecord(record)?.[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  const nested = asRecord(value);
  const text = nested?.["#text"];

  return typeof text === "string" || typeof text === "number"
    ? String(text)
    : null;
}

function getTradingItems(container) {
  const itemArray = asRecord(container?.ItemArray);

  return asArray(itemArray?.Item).flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

function getTotalPages(container) {
  const total = Number(
    getString(asRecord(container?.PaginationResult), "TotalNumberOfPages"),
  );

  return Number.isInteger(total) && total > 0 ? total : null;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function sqlQuote(value) {
  if (value == null) return "null";

  return `'${String(value).replaceAll("'", "''")}'`;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

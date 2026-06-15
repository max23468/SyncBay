#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

import { XMLParser } from "fast-xml-parser";

import {
  buildCategoryApplyPlan,
  buildCategoryBackfillReport,
} from "../app/lib/syncbay-category-backfill-report.ts";
import { shouldRefreshCategoryFromTrading } from "../app/lib/syncbay-category-trading-refresh.ts";
import { getSyncBayCategorySourceFromMetafields } from "../app/lib/syncbay-shopify-product-metafields.ts";
import { resolveShopifyCategoryProposal } from "../app/lib/syncbay-shopify-category-mapping.ts";
import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";
import { selectTokenEncryptionKey } from "./syncbay-token-key-source.mjs";

const TRADING_API_COMPATIBILITY_LEVEL = "1453";
const TOKEN_ENCRYPTION_KEYCHAIN_SERVICE = "syncbay-token-encryption-key";
const DEFAULT_SHOP_DOMAIN = "syncbay-dev.myshopify.com";
const MAX_RUNTIME_PRODUCT_BATCH_SIZE = 20;
const GET_ITEM_CONCURRENCY = 4;
const APPLY_CONCURRENCY = 4;
const SHOPIFY_ADMIN_API_VERSION = "2026-04";
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

const shopDomain =
  args.shop ?? process.env.SHOPIFY_DEV_STORE ?? DEFAULT_SHOP_DOMAIN;

loadDotEnv(".env");
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
  console.error(`Dry-run categorie non riuscito: ${formatError(error)}`);
  process.exit(1);
});

async function main() {
  if (args.apply && !args.confirmApply) {
    throw new Error(
      "Apply categorie bloccato: aggiungi --confirm-apply per scrivere su Shopify.",
    );
  }

  if (!args.apply && args.confirmApply) {
    throw new Error("--confirm-apply richiede anche --apply.");
  }

  if (
    args.apply &&
    args.repairCategoryConflicts &&
    !args.confirmRepairCategoryConflicts
  ) {
    throw new Error(
      "Riparazione conflitti categoria bloccata: aggiungi --confirm-repair-category-conflicts.",
    );
  }

  if (args.confirmRepairCategoryConflicts && !args.repairCategoryConflicts) {
    throw new Error(
      "--confirm-repair-category-conflicts richiede anche --repair-category-conflicts.",
    );
  }

  const state = getBackfillState();

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

  const shopifyAccessToken = await getShopifyAccessToken(state.shopifySession);
  const shopifyProducts = await loadShopifyProducts({
    accessToken: shopifyAccessToken,
    productGids: mappings.map((row) => row.shopifyProductGid).filter(Boolean),
  });
  const { accessToken } = await getAccessToken(state.connection);
  const rows = await mapWithConcurrency(
    mappings,
    GET_ITEM_CONCURRENCY,
    async (mapping) =>
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
  return shouldRefreshCategoryFromTrading(source);
}

function mergeCategorySources(snapshotSource, metafieldSource) {
  return {
    ebayPrimaryCategoryId:
      snapshotSource.ebayPrimaryCategoryId ??
      metafieldSource?.ebayPrimaryCategoryId ??
      null,
    ebayPrimaryCategoryName:
      snapshotSource.ebayPrimaryCategoryName ??
      metafieldSource?.ebayPrimaryCategoryName ??
      null,
    ebayPrimaryCategoryPath:
      snapshotSource.ebayPrimaryCategoryPath ??
      metafieldSource?.ebayPrimaryCategoryPath ??
      null,
    ebayStoreCategoryName:
      snapshotSource.ebayStoreCategoryName ??
      metafieldSource?.storeCategoryPath ??
      metafieldSource?.storeCategoryName ??
      null,
    title: snapshotSource.title,
  };
}

function getMetafieldCategorySource(shopifyProduct) {
  return getSyncBayCategorySourceFromMetafields(
    shopifyProduct?.metafields?.nodes,
  );
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

function getBackfillState() {
  const rows = querySupabaseJson(`
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

  for (const batch of chunkArray(
    uniqueProductGids,
    MAX_RUNTIME_PRODUCT_BATCH_SIZE,
  )) {
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
    },
  );
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

async function getTradingItem(input) {
  const body = await tradingCall({
    accessToken: input.accessToken,
    callName: "GetItem",
    connection: input.connection,
    requestXml: `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnAll</DetailLevel>
  <ErrorLanguage>it_IT</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <ItemID>${escapeXml(input.itemId)}</ItemID>
</GetItemRequest>`,
  });

  return asRecord(body.Item);
}

async function applyCategoryPlan(input) {
  const results = await mapWithConcurrency(
    input.plan.rows,
    APPLY_CONCURRENCY,
    async (row) =>
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

async function tradingCall(input) {
  const response = await fetch(
    getTradingBaseUrl(input.connection.environment),
    {
      body: input.requestXml,
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "X-EBAY-API-CALL-NAME": input.callName,
        "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_API_COMPATIBILITY_LEVEL,
        "X-EBAY-API-IAF-TOKEN": input.accessToken,
        "X-EBAY-API-SITEID": getTradingSiteId(input.connection.marketplaceId),
      },
      method: "POST",
    },
  );
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`eBay Trading API HTTP ${response.status}.`);
  }

  const parsed = xmlParser.parse(responseText);
  const body = asRecord(asRecord(parsed)?.[`${input.callName}Response`]);
  if (!body) {
    throw new Error(`eBay Trading API ${input.callName} non leggibile.`);
  }

  const ack = getString(body, "Ack");
  if (ack && !["Success", "Warning"].includes(ack)) {
    const errors = asRecord(body.Errors);
    throw new Error(
      getString(errors, "LongMessage") ??
        getString(errors, "ShortMessage") ??
        `eBay Trading API ${input.callName} non riuscita.`,
    );
  }

  return body;
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
      json.error_description ??
        json.error ??
        "Refresh token eBay non riuscito.",
    );
  }

  const tokenExpiresAt = new Date(
    Date.now() + Number(json.expires_in ?? 7200) * 1000,
  );
  const encryptedAccessToken = encryptSecret(json.access_token);

  querySupabaseJson(`
update "EbayConnection"
set "encryptedAccessToken" = ${sqlQuote(encryptedAccessToken)},
    "lastRefreshAt" = now(),
    "tokenExpiresAt" = ${sqlQuote(tokenExpiresAt.toISOString())}::timestamp,
    "scopes" = coalesce(${sqlQuote(json.scope ?? null)}, "scopes"),
    "updatedAt" = now()
where id = ${sqlQuote(connection.id)}
returning id;
`);

  return { accessToken: json.access_token };
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
  const normalizedId =
    rawId && rawId !== "0" && rawId !== "-999" ? rawId : null;
  const name = getString(storefront, "StoreCategoryName");

  return normalizedId && name ? name : null;
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
      encoding: "utf8",
      env: supabaseEnv,
      maxBuffer: 20 * 1024 * 1024,
    },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }

  return JSON.parse(result.stdout).rows;
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
  const keychainSecret = readKeychainSecret(TOKEN_ENCRYPTION_KEYCHAIN_SERVICE);
  const selected = selectTokenEncryptionKey({
    envValue: process.env.TOKEN_ENCRYPTION_KEY,
    keychainValue: keychainSecret,
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
  console.log(
    `Senza prodotto Shopify collegato: ${report.summary.missingShopifyProduct}`,
  );
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
    console.log(
      `- non eseguito; righe applicabili pianificate: ${apply.planned}`,
    );
  } else {
    console.log(`- richiesto con conferma esplicita`);
    console.log(`- applicati: ${apply.applied}`);
    console.log(`- falliti: ${apply.failed}`);
  }

  console.log(
    `- riparazione conflitti categoria: ${apply.repairCategoryConflicts ? "inclusa" : "non inclusa"}`,
  );
  console.log(`- già corretti saltati: ${apply.skipped.alreadyCorrect}`);
  console.log(`- conflitti manuali saltati: ${apply.skipped.conflictsManual}`);
  console.log(`- incerti saltati: ${apply.skipped.uncertain}`);
  console.log(
    `- senza prodotto Shopify saltati: ${apply.skipped.missingShopifyProduct}`,
  );
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

    if (arg === "--repair-category-conflicts") {
      parsed.repairCategoryConflicts = true;
      continue;
    }

    if (arg === "--confirm-repair-category-conflicts") {
      parsed.confirmRepairCategoryConflicts = true;
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

    if (arg === "--limit") {
      const value = Number.parseInt(rawArgs[index + 1] ?? "", 10);
      parsed.limit = Number.isInteger(value) && value > 0 ? value : undefined;
      index += 1;
      continue;
    }

    throw new Error(`Argomento non supportato: ${arg}`);
  }

  return parsed;
}

function printUsage() {
  console.log(`Uso: npm run categories:backfill -- [--shop dominio.myshopify.com] [--limit N] [--json] [--apply --confirm-apply] [--repair-category-conflicts --confirm-repair-category-conflicts]

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
                    Conferma obbligatoria per sovrascrivere quei conflitti.`);
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

function getTradingSiteId(marketplaceId) {
  if (marketplaceId === "EBAY_IT") return "101";

  throw new Error(`Marketplace Trading API non supportato: ${marketplaceId}.`);
}

function requiredEnv(key) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} non configurata.`);

  return value;
}

function hasScope(scopeText, requiredScope) {
  return String(scopeText)
    .split(",")
    .map((scope) => scope.trim())
    .includes(requiredScope);
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
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

function normalizeText(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const normalized = String(value).trim();

  return normalized.length > 0 ? normalized : null;
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

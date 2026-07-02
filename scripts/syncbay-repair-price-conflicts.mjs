#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { XMLParser } from "fast-xml-parser";
// @ts-expect-error Node --experimental-strip-types resolves this import.
import { getAlignedPriceConflictRepair } from "../app/lib/syncbay-price-conflict-alignment.ts";
import {
  getSupabaseCliCwd,
  getSupabaseCliEnv,
} from "./supabase-cli-env.mjs";
import { selectTokenEncryptionKey } from "./syncbay-token-key-source.mjs";

const execFileAsync = promisify(execFile);

const DEFAULT_SHOP_DOMAIN = "syncbay-dev.myshopify.com";
const TOKEN_ENCRYPTION_KEYCHAIN_SERVICE = "syncbay-token-encryption-key";
const TRADING_API_COMPATIBILITY_LEVEL = "1453";
const EBAY_LIVE_CONCURRENCY = 3;
const xmlParser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  removeNSPrefix: true,
  textNodeName: "#text",
  trimValues: true,
});

loadDotEnv(".env");

const args = parseArgs(process.argv.slice(2));
const shopDomain =
  args.shop ?? process.env.SHOPIFY_DEV_STORE ?? DEFAULT_SHOP_DOMAIN;

await main().catch((error) => {
  console.error(`Repair conflitti prezzo non riuscito: ${formatCliError(error)}`);
  process.exit(1);
});

async function main() {
  const candidates = await loadOpenPriceConflicts();
  const connection = candidates.length > 0 ? await loadEbayConnection() : null;
  const liveCandidates =
    candidates.length > 0
      ? await attachLiveEbayPrices(candidates, connection)
      : candidates;
  const repairs = buildRepairs(liveCandidates);
  const result = args.apply
    ? await applyRepairs(repairs)
    : buildDryRunResult(liveCandidates, repairs);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printSummary(result, args.apply);
}

async function loadOpenPriceConflicts() {
  const payload = await querySupabaseJson(buildCandidateSql());

  return payload.rows?.[0]?.rows ?? [];
}

async function loadEbayConnection() {
  const payload = await querySupabaseJson(`
with shop_row as (
  select id
  from "Shop"
  where "shopDomain" = ${sqlString(shopDomain)}
  limit 1
)
select to_jsonb(ec) as connection
from "EbayConnection" ec
join shop_row s on s.id = ec."shopId"
where ec."marketplaceId" = 'EBAY_IT'
  and ec.status = 'CONNECTED'
limit 1;
`);

  return payload.rows?.[0]?.connection ?? null;
}

function buildCandidateSql() {
  return `
with shop_row as (
  select id, "shopDomain"
  from "Shop"
  where "shopDomain" = ${sqlString(shopDomain)}
  limit 1
),
pricing_rule as (
  select
    coalesce(pr."discountPercent", 0)::int as "discountPercent",
    coalesce(pr."roundingMode"::text, 'CENTS') as "roundingMode"
  from shop_row s
  left join "PricingRule" pr on pr."shopId" = s.id
),
latest_ebay_price as (
  select distinct on (ps."mappingId")
    ps."mappingId",
    ps."priceAmount"::text as "ebayPriceAmount"
  from "ProductSnapshot" ps
  join shop_row s on s.id = ps."shopId"
  where ps.source = 'EBAY'
    and ps."mappingId" is not null
    and ps."priceAmount" is not null
  order by ps."mappingId", ps."capturedAt" desc
),
latest_syncbay as (
  select distinct on (ps."mappingId")
    ps.*
  from "ProductSnapshot" ps
  join shop_row s on s.id = ps."shopId"
  where ps.source = 'SYNCBAY'
    and ps."mappingId" is not null
  order by ps."mappingId", ps."capturedAt" desc
),
current_field_baselines as (
  select
    ls.*,
    title_snapshot.title as "currentTitle",
    price_snapshot.currency as "currentCurrency",
    quantity_snapshot.quantity as "currentQuantity",
    status_snapshot."productStatus" as "currentProductStatus",
    description_snapshot."descriptionHash" as "currentDescriptionHash",
    image_snapshot."imageCount" as "currentImageCount"
  from latest_syncbay ls
  left join lateral (
    select ps.title
    from "ProductSnapshot" ps
    where ps."mappingId" = ls."mappingId"
      and ps.source = 'SYNCBAY'
      and ps.title is not null
    order by ps."capturedAt" desc
    limit 1
  ) title_snapshot on true
  left join lateral (
    select ps.currency
    from "ProductSnapshot" ps
    where ps."mappingId" = ls."mappingId"
      and ps.source = 'SYNCBAY'
      and ps."priceAmount" is not null
    order by ps."capturedAt" desc
    limit 1
  ) price_snapshot on true
  left join lateral (
    select ps.quantity
    from "ProductSnapshot" ps
    where ps."mappingId" = ls."mappingId"
      and ps.source = 'SYNCBAY'
      and ps.quantity is not null
    order by ps."capturedAt" desc
    limit 1
  ) quantity_snapshot on true
  left join lateral (
    select ps."productStatus"
    from "ProductSnapshot" ps
    where ps."mappingId" = ls."mappingId"
      and ps.source = 'SYNCBAY'
      and ps."productStatus" is not null
    order by ps."capturedAt" desc
    limit 1
  ) status_snapshot on true
  left join lateral (
    select ps."descriptionHash"
    from "ProductSnapshot" ps
    where ps."mappingId" = ls."mappingId"
      and ps.source = 'SYNCBAY'
      and ps."descriptionHash" is not null
    order by ps."capturedAt" desc
    limit 1
  ) description_snapshot on true
  left join lateral (
    select ps."imageCount"
    from "ProductSnapshot" ps
    where ps."mappingId" = ls."mappingId"
      and ps.source = 'SYNCBAY'
      and ps."imageCount" is not null
    order by ps."capturedAt" desc
    limit 1
  ) image_snapshot on true
)
select coalesce(jsonb_agg(to_jsonb(rows) order by rows."detectedAt"), '[]'::jsonb) as rows
from (
  select
    sc.id as "conflictId",
    sc.field,
    sc."lastSyncBayValue",
    sc."shopifyValue",
    sc."detectedAt",
    s.id as "shopId",
    s."shopDomain",
    pm.id as "mappingId",
    pm."ebayItemId",
    pm."shopifyProductGid",
    pm."shopifyVariantGid",
    pm.sku as "mappingSku",
    e."ebayPriceAmount",
    pr."discountPercent",
    pr."roundingMode",
    cb."currentTitle",
    cb."currentCurrency",
    cb."currentQuantity",
    cb."currentProductStatus",
    cb."currentDescriptionHash",
    cb."currentImageCount",
    cb.payload
  from "SyncConflict" sc
  join shop_row s on s.id = sc."shopId"
  join "ProductMapping" pm on pm.id = sc."mappingId"
  left join latest_ebay_price e on e."mappingId" = pm.id
  join current_field_baselines cb on cb."mappingId" = pm.id
  cross join pricing_rule pr
  where sc.status = 'OPEN'
    and sc.field = 'price'
    and pm.status = 'ACTIVE'
) rows;
`;
}

async function attachLiveEbayPrices(rows, connection) {
  if (!connection) {
    throw new Error(`Nessuna connessione eBay attiva per ${shopDomain}.`);
  }

  ensureTokenEncryptionKey();
  const { accessToken } = await getAccessToken(connection);

  return mapWithConcurrency(rows, EBAY_LIVE_CONCURRENCY, async (row) => {
    try {
      const item = await getTradingItem({
        accessToken,
        connection,
        itemId: row.ebayItemId,
      });
      const variations = getTradingVariations(item);
      const listingStatus =
        getString(asRecord(item.SellingStatus), "ListingStatus") ??
        getString(item, "ListingStatus");

      return {
        ...row,
        ebayListingStatus: listingStatus,
        ebayLiveOk: true,
        ebayPriceAmount: getTradingPrice(item, variations),
      };
    } catch (error) {
      return {
        ...row,
        ebayLiveError: sanitizeErrorText(error?.message ?? String(error)),
        ebayLiveOk: false,
      };
    }
  });
}

function buildRepairs(rows) {
  return rows.flatMap((row) => {
    if (!row.ebayLiveOk || row.ebayListingStatus !== "Active") return [];

    const repair = getAlignedPriceConflictRepair({
      ebayPriceAmount: parseMoney(row.ebayPriceAmount),
      field: row.field,
      latestSyncBayValue: row.lastSyncBayValue,
      pricingRule: {
        discountPercent: Number(row.discountPercent ?? 0),
        roundingMode: row.roundingMode === "WHOLE_EURO" ? "WHOLE_EURO" : "CENTS",
      },
      shopifyValue: row.shopifyValue,
    });

    if (!repair) return [];

    return [
      {
        applied: repair.applied,
        compareAtPrice: repair.compareAtPrice,
        compareAtPriceAmount: repair.compareAtPriceAmount,
        conflictId: row.conflictId,
        currentCurrency: row.currentCurrency,
        currentDescriptionHash: row.currentDescriptionHash,
        currentImageCount: row.currentImageCount,
        currentProductStatus: row.currentProductStatus,
        currentQuantity: row.currentQuantity,
        currentTitle: row.currentTitle,
        discountPercent: repair.discountPercent,
        ebayItemId: row.ebayItemId,
        ebayPriceAmount: repair.ebayPriceAmount,
        mappingId: row.mappingId,
        mappingSku: row.mappingSku,
        payload: row.payload,
        price: repair.price,
        priceAmount: repair.priceAmount,
        roundingMode: repair.roundingMode,
        shopId: row.shopId,
        shopifyProductGid: row.shopifyProductGid,
        shopifyVariantGid: row.shopifyVariantGid,
      },
    ];
  });
}

function buildDryRunResult(candidates, repairs) {
  const liveFailures = candidates.filter((row) => !row.ebayLiveOk).length;

  return {
    checkedAt: new Date().toISOString(),
    ebayLiveCheckedCount: candidates.length,
    ebayLiveFailureCount: liveFailures,
    mode: "dry-run",
    openPriceConflictCount: candidates.length,
    repairablePriceConflictCount: repairs.length,
    skippedPriceConflictCount: candidates.length - repairs.length,
    shopDomain,
    sample: repairs.slice(0, 10).map((repair) => ({
      compareAtPrice: repair.compareAtPrice,
      ebayItemId: repair.ebayItemId,
      price: repair.price,
    })),
  };
}

async function applyRepairs(repairs) {
  if (repairs.length === 0) {
    return {
      checkedAt: new Date().toISOString(),
      insertedSnapshotCount: 0,
      mode: "apply",
      repairablePriceConflictCount: 0,
      resolvedConflictCount: 0,
      shopDomain,
    };
  }

  const payload = await querySupabaseJson(buildApplySql(repairs));

  return payload.rows?.[0]?.result;
}

function buildApplySql(repairs) {
  const repairsJson = sqlString(JSON.stringify(repairs));

  return `
with repair_rows as (
  select *
  from jsonb_to_recordset(${repairsJson}::jsonb) as r(
    "conflictId" text,
    "shopId" text,
    "mappingId" text,
    "ebayItemId" text,
    "shopifyProductGid" text,
    "shopifyVariantGid" text,
    "mappingSku" text,
    "currentTitle" text,
    "currentCurrency" text,
    "currentQuantity" int,
    "currentProductStatus" text,
    "currentDescriptionHash" text,
    "currentImageCount" int,
    payload jsonb,
    "priceAmount" numeric,
    "compareAtPriceAmount" numeric,
    "ebayPriceAmount" numeric,
    "discountPercent" int,
    "roundingMode" text,
    applied boolean
  )
),
inserted_snapshots as (
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
    "priceAmount",
    currency,
    quantity,
    "productStatus",
    "descriptionHash",
    "imageCount",
    payload,
    "capturedAt"
  )
  select
    gen_random_uuid()::text,
    r."shopId",
    r."mappingId",
    'SYNCBAY',
    r."ebayItemId",
    r."shopifyProductGid",
    r."shopifyVariantGid",
    r."mappingSku",
    r."currentTitle",
    r."priceAmount",
    r."currentCurrency",
    r."currentQuantity",
    r."currentProductStatus",
    r."currentDescriptionHash",
    r."currentImageCount",
    (coalesce(r.payload, '{}'::jsonb) - 'updatedEbayFromShopifyOrder' - 'restoredEbayAfterTest') ||
      jsonb_build_object(
        'conflictResolution',
        jsonb_build_object(
          'conflictId', r."conflictId",
          'field', 'price',
          'resolution', 'KEEP_SHOPIFY',
          'source', 'targeted_price_conflict_repair'
        ),
        'priceConflictBaselineRepair',
        jsonb_build_object(
          'conflictId', r."conflictId",
          'repairedAt', now()
        ),
        'pricing',
        coalesce(r.payload->'pricing', '{}'::jsonb) || jsonb_build_object(
          'applied', r.applied,
          'compareAtPriceAmount', r."compareAtPriceAmount",
          'discountPercent', r."discountPercent",
          'ebayPriceAmount', r."ebayPriceAmount",
          'priceAmount', r."priceAmount",
          'roundingMode', r."roundingMode"
        )
      ),
    now()
  from repair_rows r
  returning id
),
updated_conflicts as (
  update "SyncConflict" sc
  set
    status = 'RESOLVED',
    resolution = 'KEEP_SHOPIFY',
    "resolvedAt" = now(),
    "updatedAt" = now()
  where sc.id in (select "conflictId" from repair_rows)
    and sc.status = 'OPEN'
    and sc.field = 'price'
  returning sc.id, sc."mappingId"
),
updated_mappings as (
  update "ProductMapping" pm
  set "lastSyncedAt" = now()
  where pm.id in (select "mappingId" from updated_conflicts)
  returning pm.id
),
audit as (
  insert into "AuditLog" (id, "shopId", type, message, details, "createdAt")
  select
    gen_random_uuid()::text,
    (select s.id from "Shop" s where s."shopDomain" = ${sqlString(shopDomain)} limit 1),
    'CONNECTION_CHECK',
    'Falsi conflitti prezzo riparati con baseline Shopify.',
    jsonb_build_object(
      'repair', 'price_conflict_stale_baseline',
      'resolvedConflictCount', (select count(*)::int from updated_conflicts),
      'insertedSnapshotCount', (select count(*)::int from inserted_snapshots)
    ),
    now()
  where (select count(*) from updated_conflicts) > 0
  returning id
)
select jsonb_build_object(
  'checkedAt', now(),
  'mode', 'apply',
  'shopDomain', ${sqlString(shopDomain)},
  'repairablePriceConflictCount', (select count(*)::int from repair_rows),
  'resolvedConflictCount', (select count(*)::int from updated_conflicts),
  'insertedSnapshotCount', (select count(*)::int from inserted_snapshots),
  'updatedMappingCount', (select count(*)::int from updated_mappings),
  'auditLogInserted', (select count(*)::int from audit) > 0
) as result;
`;
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
  const encryptedAccessToken = encryptSecret(json.access_token);

  await querySupabaseJson(`
update "EbayConnection"
set "encryptedAccessToken" = ${sqlString(encryptedAccessToken)},
    "lastRefreshAt" = now(),
    "tokenExpiresAt" = ${sqlString(tokenExpiresAt.toISOString())}::timestamp,
    "scopes" = coalesce(${sqlString(json.scope ?? null)}, "scopes"),
    "updatedAt" = now()
where id = ${sqlString(connection.id)}
returning id;
`);

  return { accessToken: json.access_token };
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

async function tradingCall(input) {
  const response = await fetch(getTradingBaseUrl(input.connection.environment), {
    body: input.requestXml,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "X-EBAY-API-CALL-NAME": input.callName,
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

function getTradingVariations(item) {
  const variations = asRecord(item?.Variations);
  const variation = asRecord(variations?.Variation);

  if (variation) return [variation];

  return asArray(variations?.Variation).flatMap((entry) => {
    const record = asRecord(entry);
    return record ? [record] : [];
  });
}

function getTradingPrice(item, variations) {
  return (
    getMoneyValue(asRecord(item?.SellingStatus)?.CurrentPrice) ??
    getMoneyValue(item?.StartPrice) ??
    getMoneyValue(item?.BuyItNowPrice) ??
    variations
      .map((variation) => getMoneyValue(variation.StartPrice))
      .find((price) => typeof price === "number") ??
    null
  );
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
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return results;
}

async function querySupabaseJson(sql) {
  const { stdout } = await execFileAsync(
    "npx",
    ["supabase", "db", "query", "--linked", "--output", "json", sql],
    {
      cwd: getSupabaseCliCwd(),
      env: await getSupabaseCliEnv(),
      maxBuffer: 1024 * 1024 * 10,
      timeout: 45_000,
    },
  );
  const jsonStart = findJsonStart(stdout);

  if (jsonStart < 0) {
    throw new Error("Supabase CLI non ha restituito JSON.");
  }

  const parsed = JSON.parse(stdout.slice(jsonStart));

  return Array.isArray(parsed) ? { rows: parsed } : parsed;
}

function findJsonStart(value) {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");

  if (objectStart < 0) return arrayStart;
  if (arrayStart < 0) return objectStart;

  return Math.min(objectStart, arrayStart);
}

function printSummary(result, apply) {
  console.log(`Shop: ${result.shopDomain}`);
  console.log(`Modo: ${result.mode}`);

  if (apply) {
    console.log(`Conflitti prezzo risolti: ${result.resolvedConflictCount}`);
    console.log(`Baseline create: ${result.insertedSnapshotCount}`);
    return;
  }

  console.log(`Conflitti prezzo aperti: ${result.openPriceConflictCount}`);
  console.log(`Riparabili: ${result.repairablePriceConflictCount}`);
  console.log(`Saltati: ${result.skippedPriceConflictCount}`);

  if (result.repairablePriceConflictCount > 0) {
    console.log("Prossimo passo: npm run conflicts:repair-price -- --apply");
  }
}

function parseArgs(rawArgs) {
  const parsed = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--apply") {
      parsed.apply = true;
      continue;
    }

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--shop") {
      parsed.shop = rawArgs[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(`Uso: npm run conflicts:repair-price -- [--shop dominio.myshopify.com] [--apply] [--json]

Ripara conflitti prezzo aperti quando il valore Shopify registrato nel conflitto
combacia con il prezzo eBay normalizzato dalla regola prezzo corrente. Non
scrive su Shopify o eBay; crea una baseline SyncBay e chiude il conflitto.`);
      process.exit(0);
    }

    throw new Error(`Argomento non supportato: ${arg}`);
  }

  return parsed;
}

function parseMoney(value) {
  const amount = Number(value);

  return Number.isFinite(amount) && amount > 0 ? amount : null;
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

function getMoneyValue(value) {
  const text = toText(value);
  if (!text) return null;

  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function getString(record, key) {
  return record ? normalizeText(toText(record[key])) : null;
}

function toText(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  const record = asRecord(value);
  const text = record?.["#text"];
  if (typeof text === "string") return text;
  if (typeof text === "number") return String(text);

  return null;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || typeof value === "undefined") return [];

  return [value];
}

function normalizeText(value) {
  const normalized = value?.trim();

  return normalized && normalized.length > 0 ? normalized : null;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatCliError(error) {
  const stderr =
    typeof error?.stderr === "string" ? sanitizeErrorText(error.stderr) : "";
  const message = sanitizeErrorText(error?.message ?? String(error));
  const useful = stderr || message;

  if (useful.includes("ECIRCUITBREAKER")) {
    return "Supabase ha bloccato temporaneamente nuove connessioni per troppi tentativi di autenticazione. Attendi qualche minuto e riprova.";
  }

  if (error?.signal === "SIGTERM") {
    return "timeout durante la query Supabase. Riprova tra poco o riduci il carico di query concorrenti.";
  }

  return useful.split("\n").filter(Boolean).slice(0, 3).join(" ");
}

function sanitizeErrorText(value) {
  return String(value)
    .replaceAll(/\nwith shop_row[\s\S]*/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function sqlString(value) {
  if (value == null) return "null";

  return `'${String(value).replaceAll("'", "''")}'`;
}

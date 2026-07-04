#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { XMLParser } from "fast-xml-parser";

import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";
import { selectTokenEncryptionKey } from "./syncbay-token-key-source.mjs";

const TRADING_API_COMPATIBILITY_LEVEL = "1453";
const TOKEN_ENCRYPTION_KEYCHAIN_SERVICE = "syncbay-token-encryption-key";
const DEFAULT_LIMIT = 20;
const DEFAULT_EBAY_LIMIT = 10;

let args = null;
let shopDomain = null;
let supabaseEnv = null;

const xmlParser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  removeNSPrefix: true,
  textNodeName: "#text",
  trimValues: true,
});

if (isCliEntrypoint()) {
  args = parseArgs(process.argv.slice(2));
  loadDotEnv(".env");
  shopDomain = resolveCatalogImagesDoctorShopDomain({
    args,
    env: process.env,
  });
  ensureTokenEncryptionKey();
  supabaseEnv = {
    ...process.env,
    ...(await getSupabaseCliEnv()),
    SUPABASE_TELEMETRY_DISABLED: "1",
  };

  await main().catch((error) => {
    console.error(
      `Diagnostica immagini Catalogo non riuscita: ${error.message}`,
    );
    process.exit(1);
  });
}

async function main() {
  const state = getDiagnosticState();

  if (!state.connection) {
    throw new Error(`Nessuna connessione eBay attiva per ${shopDomain}.`);
  }

  const rows = Array.isArray(state.rows) ? state.rows : [];
  const noImageRows = rows.filter(
    (row) => !row.hasAnyPayloadUrl && Number(row.latestImageCount ?? 0) === 0,
  );
  const checkedRows = noImageRows.slice(0, args.ebayLimit);
  const { accessToken } = await getAccessToken(state.connection);
  const ebayChecks = await mapWithConcurrency(checkedRows, 3, async (row) => {
    try {
      const item = await getTradingItem({
        accessToken,
        connection: state.connection,
        itemId: row.ebayItemId,
      });
      const imageCount = getTradingImageUrls(item).length;

      return {
        imageCount,
        ok: true,
        position: row.position,
      };
    } catch (error) {
      return {
        errorMessage: error.message,
        imageCount: null,
        ok: false,
        position: row.position,
      };
    }
  });
  const report = {
    shopDomain,
    limit: args.limit,
    summary: state.summary,
    firstRows: rows.map((row) => ({
      hasAnyPayloadUrl: Boolean(row.hasAnyPayloadUrl),
      latestImageCount: Number(row.latestImageCount ?? 0),
      latestSource: row.latestSource ?? null,
      position: row.position,
    })),
    ebayLiveCheck: {
      checked: ebayChecks.length,
      failed: ebayChecks.filter((row) => !row.ok).length,
      withImages: ebayChecks.filter((row) => Number(row.imageCount ?? 0) > 0)
        .length,
      withoutImages: ebayChecks.filter((row) => row.ok && row.imageCount === 0)
        .length,
      rows: ebayChecks,
    },
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printReport(report);
}

function getDiagnosticState() {
  const rows = querySupabaseJson(`
with shop_row as (
  select id from "Shop" where "shopDomain" = ${sqlQuote(shopDomain)} limit 1
),
connection as (
  select ec.*
  from "EbayConnection" ec
  join shop_row s on s.id = ec."shopId"
  where ec."marketplaceId" = 'EBAY_IT'
    and ec.status = 'CONNECTED'
  limit 1
),
catalog as (
  select
    row_number() over (order by pm.status asc, pm."updatedAt" desc) as position,
    pm.id,
    pm."ebayItemId",
    pm."shopifyProductGid",
    pm.status,
    pm."updatedAt"
  from "ProductMapping" pm
  join shop_row s on s.id = pm."shopId"
  where pm."marketplaceId" = 'EBAY_IT'
),
first_rows as (
  select *
  from catalog
  order by status asc, "updatedAt" desc
  limit ${args.limit}
),
latest_any as (
  select distinct on (ps."mappingId")
    ps."mappingId",
    ps.source,
    ps."imageCount",
    ps.payload
  from "ProductSnapshot" ps
  join catalog c on c.id = ps."mappingId"
  order by ps."mappingId", ps."capturedAt" desc
),
latest_ebay as (
  select distinct on (ps."mappingId")
    ps."mappingId",
    ps."imageCount"
  from "ProductSnapshot" ps
  join catalog c on c.id = ps."mappingId"
  where ps.source = 'EBAY'
  order by ps."mappingId", ps."capturedAt" desc
),
latest_syncbay as (
  select distinct on (ps."mappingId")
    ps."mappingId",
    ps."imageCount"
  from "ProductSnapshot" ps
  join catalog c on c.id = ps."mappingId"
  where ps.source = 'SYNCBAY'
  order by ps."mappingId", ps."capturedAt" desc
),
any_payload_with_url as (
  select distinct ps."mappingId"
  from "ProductSnapshot" ps
  join catalog c on c.id = ps."mappingId"
  where (
    jsonb_typeof(ps.payload->'imageUrls') = 'array'
    and jsonb_array_length(ps.payload->'imageUrls') > 0
  ) or (
    jsonb_typeof(ps.payload#>'{mediaSync,sourceImageUrls}') = 'array'
    and jsonb_array_length(ps.payload#>'{mediaSync,sourceImageUrls}') > 0
  ) or coalesce(
    ps.payload->>'thumbnailUrl',
    ps.payload->>'imageUrl',
    ps.payload->>'galleryUrl',
    ps.payload->>'GalleryURL'
  ) is not null
),
scoped as (
  select
    'all' as scope,
    c.id,
    c."shopifyProductGid",
    la.source as latest_source,
    la."imageCount" as latest_image_count,
    le."imageCount" as ebay_image_count,
    ls."imageCount" as syncbay_image_count,
    ap."mappingId" is not null as has_any_payload_url
  from catalog c
  left join latest_any la on la."mappingId" = c.id
  left join latest_ebay le on le."mappingId" = c.id
  left join latest_syncbay ls on ls."mappingId" = c.id
  left join any_payload_with_url ap on ap."mappingId" = c.id
  union all
  select
    'first_page' as scope,
    c.id,
    c."shopifyProductGid",
    la.source as latest_source,
    la."imageCount" as latest_image_count,
    le."imageCount" as ebay_image_count,
    ls."imageCount" as syncbay_image_count,
    ap."mappingId" is not null as has_any_payload_url
  from (select * from catalog order by status asc, "updatedAt" desc limit 50) c
  left join latest_any la on la."mappingId" = c.id
  left join latest_ebay le on le."mappingId" = c.id
  left join latest_syncbay ls on ls."mappingId" = c.id
  left join any_payload_with_url ap on ap."mappingId" = c.id
)
select jsonb_build_object(
  'connection', (select to_jsonb(connection) from connection),
  'summary', coalesce((
    select jsonb_agg(to_jsonb(summary) order by scope)
    from (
      select
        scope,
        count(*)::int as "mappingCount",
        count(*) filter (where "shopifyProductGid" is not null)::int as "withShopifyProduct",
        count(*) filter (where coalesce(latest_image_count, 0) > 0)::int as "latestSnapshotImageCountPositive",
        count(*) filter (where coalesce(ebay_image_count, 0) > 0)::int as "latestEbayImageCountPositive",
        count(*) filter (where coalesce(syncbay_image_count, 0) > 0)::int as "latestSyncBayImageCountPositive",
        count(*) filter (where has_any_payload_url)::int as "anySnapshotPayloadUrl"
      from scoped
      group by scope
    ) summary
  ), '[]'::jsonb),
  'rows', coalesce((
    select jsonb_agg(to_jsonb(row) order by position)
    from (
      select
        fr.position,
        fr."ebayItemId" as "ebayItemId",
        la.source as "latestSource",
        coalesce(la."imageCount", 0) as "latestImageCount",
        ap."mappingId" is not null as "hasAnyPayloadUrl"
      from first_rows fr
      left join latest_any la on la."mappingId" = fr.id
      left join any_payload_with_url ap on ap."mappingId" = fr.id
    ) row
  ), '[]'::jsonb)
) as payload;
`);

  return rows[0]?.payload ?? {};
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

function getTradingImageUrls(item) {
  const pictureDetails = asRecord(item?.PictureDetails);
  const directUrls = asArray(pictureDetails?.PictureURL).flatMap((url) => {
    const text = normalizeText(toText(url));
    return text ? [text] : [];
  });

  if (directUrls.length > 0) return directUrls;

  const variations = asRecord(item?.Variations);
  const pictures = asRecord(variations?.Pictures);
  const pictureSets = asArray(pictures?.VariationSpecificPictureSet);

  return pictureSets.flatMap((pictureSet) => {
    const record = asRecord(pictureSet);
    return asArray(record?.PictureURL).flatMap((url) => {
      const text = normalizeText(toText(url));
      return text ? [text] : [];
    });
  });
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

  const parsed = JSON.parse(result.stdout);
  const rows = Array.isArray(parsed) ? parsed : parsed.rows;

  if (!Array.isArray(rows)) {
    throw new Error("Output Supabase inatteso: rows non e' un array JSON.");
  }

  return rows;
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
  console.log(`Righe vista analizzate: ${report.limit}`);
  console.log("");

  for (const row of report.summary ?? []) {
    console.log(
      `${row.scope}: mapping ${row.mappingCount}, Shopify ${row.withShopifyProduct}, ` +
        `snapshot con immagini ${row.latestSnapshotImageCountPositive}, ` +
        `eBay con immagini ${row.latestEbayImageCountPositive}, ` +
        `SyncBay con immagini ${row.latestSyncBayImageCountPositive}, ` +
        `payload URL ${row.anySnapshotPayloadUrl}`,
    );
  }

  console.log("");
  console.log(
    `Prime ${report.firstRows.length} righe: ` +
      `${report.firstRows.filter((row) => row.hasAnyPayloadUrl).length} con URL immagine in snapshot, ` +
      `${report.firstRows.filter((row) => row.latestImageCount > 0).length} con imageCount > 0.`,
  );
  console.log(
    `eBay live sulle righe senza immagine: ${report.ebayLiveCheck.checked} controllate, ` +
      `${report.ebayLiveCheck.withImages} ora hanno immagini, ` +
      `${report.ebayLiveCheck.withoutImages} restano senza immagini, ` +
      `${report.ebayLiveCheck.failed} lookup falliti.`,
  );

  if (report.ebayLiveCheck.withImages > 0) {
    const positions = report.ebayLiveCheck.rows
      .filter((row) => Number(row.imageCount ?? 0) > 0)
      .map((row) => row.position)
      .join(", ");
    console.log(`Righe da riparare/backfill candidate: ${positions}.`);
  }
}

function parseArgs(rawArgs) {
  const parsed = {
    ebayLimit: DEFAULT_EBAY_LIMIT,
    limit: DEFAULT_LIMIT,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--shop") {
      parsed.shop = rawArgs[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--limit") {
      parsed.limit = parsePositiveInt(rawArgs[index + 1], DEFAULT_LIMIT);
      index += 1;
      continue;
    }

    if (arg === "--ebay-limit") {
      parsed.ebayLimit = parsePositiveInt(
        rawArgs[index + 1],
        DEFAULT_EBAY_LIMIT,
      );
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Argomento non supportato: ${arg}`);
  }

  return parsed;
}

export function resolveCatalogImagesDoctorShopDomain(input) {
  return resolveRequiredShopDomainOption(input);
}

function isCliEntrypoint() {
  return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
}

function printUsage() {
  console.log(`Uso: npm run catalog:images:doctor -- [--shop dominio.myshopify.com] [--limit N] [--ebay-limit N] [--json]

Diagnostica in sola lettura: misura copertura immagini nel Catalogo SyncBay e
controlla con Trading API GetItem se le prime righe senza immagine hanno oggi
immagini disponibili su eBay. Non stampa URL, titoli o segreti.`);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
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
  return typeof value === "string" ? value.trim() : "";
}

function toText(value) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  const record = asRecord(value);
  const text = record?.["#text"];

  return typeof text === "string" || typeof text === "number"
    ? String(text)
    : "";
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function sqlQuote(value) {
  if (value == null) return "null";

  return `'${String(value).replaceAll("'", "''")}'`;
}

#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

import { XMLParser } from "fast-xml-parser";

import {
  parseRestoreEbayStockArgs,
  shouldCreateRestoreSnapshot,
} from "./syncbay-restore-ebay-stock-args.mjs";
import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";
import { selectTokenEncryptionKey } from "./syncbay-token-key-source.mjs";

const TRADING_API_COMPATIBILITY_LEVEL = "1453";
const TOKEN_ENCRYPTION_KEYCHAIN_SERVICE = "syncbay-token-encryption-key";

const args = parseRestoreEbayStockArgs(process.argv.slice(2));

if (args.help) {
  printUsage();
  process.exit(0);
}

if (!args.confirmRealEbayWrite) {
  console.error(
    "Operazione bloccata: aggiungi --confirm-real-ebay-write per confermare la scrittura reale su eBay.",
  );
  process.exit(1);
}

if (!args.itemId || !args.quantity) {
  printUsage();
  process.exit(1);
}

const targetQuantity = Number(args.quantity);
if (!Number.isInteger(targetQuantity) || targetQuantity < 0) {
  console.error("--quantity deve essere un intero >= 0.");
  process.exit(1);
}

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

const state = getRestoreState(args.itemId);

if (!state.mapping) {
  throw new Error(`Mapping non trovato per eBay item ${args.itemId}.`);
}
if (!state.connection || state.connection.status !== "CONNECTED") {
  throw new Error(`Connessione eBay non collegata per item ${args.itemId}.`);
}
if (state.activeCount !== 0) {
  throw new Error(
    `Coda stock/sync non vuota: ${state.activeCount} job attivi. Riprova dopo la chiusura della coda.`,
  );
}

const { accessToken, refreshed } = await getAccessToken(state.connection);

await tradingCall({
  accessToken,
  callName: "ReviseInventoryStatus",
  connection: state.connection,
  requestXml: buildReviseInventoryStatusRequest({
    itemId: args.itemId,
    quantity: targetQuantity,
    sku: args.sku,
  }),
});

const item = await getTradingItem({
  accessToken,
  connection: state.connection,
  itemId: args.itemId,
});
const sellingStatus = asRecord(item?.SellingStatus);
const verifiedQuantity = toNumberOrNull(getString(item, "Quantity"));
const verifiedQuantityAvailable = toNumberOrNull(
  getString(item, "QuantityAvailable"),
);
const verifiedQuantitySold = toNumberOrNull(
  getString(sellingStatus, "QuantitySold"),
);
const verifiedAvailableQuantity =
  verifiedQuantityAvailable ??
  (verifiedQuantity !== null && verifiedQuantitySold !== null
    ? verifiedQuantity - verifiedQuantitySold
    : null);
assertVerifiedAvailableQuantity({
  itemId: args.itemId,
  targetQuantity,
  verifiedAvailableQuantity,
});
const snapshot = shouldCreateRestoreSnapshot(args)
  ? createRestoreSnapshot({
      itemId: args.itemId,
      latest: state.latest,
      mapping: state.mapping,
      quantity: targetQuantity,
      reason: args.reason ?? "manual_restore_after_real_stock_test",
    })
  : null;

console.log(
  JSON.stringify({
    itemId: args.itemId,
    ok: true,
    snapshotSkipped: !shouldCreateRestoreSnapshot(args),
    snapshot,
    targetQuantity,
    tokenRefreshed: refreshed,
    verifiedAvailableQuantity,
    verifiedQuantity,
    verifiedQuantityAvailable,
    verifiedQuantitySold,
  }),
);

function printUsage() {
  console.log(`Uso:
  npm run stock:restore-ebay -- --item-id <ItemID> --quantity <n> --confirm-real-ebay-write [--sku <sku-eBay-reale>] [--reason <motivo>] [--skip-snapshot]

Esempio:
  npm run stock:restore-ebay -- --item-id 168148953253 --quantity 19 --confirm-real-ebay-write

Lo script:
- blocca l'esecuzione se ci sono job UPDATE_EBAY_STOCK o SYNC_INCREMENTAL attivi;
- usa il token eBay cifrato del runtime e non stampa segreti;
- chiama Trading API ReviseInventoryStatus;
- verifica con GetItem;
- scrive uno snapshot SYNCBAY di ripristino, salvo --skip-snapshot per test eBay esterni controllati.`);
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

function readKeychainSecret(service) {
  if (process.platform !== "darwin") return null;

  const result = spawnSync("security", [
    "find-generic-password",
    "-s",
    service,
    "-w",
  ], {
    encoding: "utf8",
  });

  if (result.status !== 0) return null;

  return result.stdout.replace(/\r?\n$/, "");
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

function getRestoreState(itemId) {
  const rows = querySupabaseJson(`
with mapping as (
  select *
  from "ProductMapping"
  where "ebayItemId" = ${sqlQuote(itemId)}
    and "marketplaceId" = 'EBAY_IT'
  limit 1
),
connection as (
  select ec.*
  from "EbayConnection" ec
  join mapping m on m."shopId" = ec."shopId"
  where ec."marketplaceId" = 'EBAY_IT'
  limit 1
),
latest as (
  select ps.*
  from "ProductSnapshot" ps
  join mapping m on m.id = ps."mappingId"
  order by ps."capturedAt" desc
  limit 1
),
active as (
  select count(*)::int as count
  from "SyncJob"
  where status in ('PENDING', 'RUNNING', 'RETRYING')
    and type in ('UPDATE_EBAY_STOCK', 'SYNC_INCREMENTAL')
)
select jsonb_build_object(
  'mapping', (select to_jsonb(mapping) from mapping),
  'connection', (select to_jsonb(connection) from connection),
  'latest', (select to_jsonb(latest) from latest),
  'activeCount', (select count from active)
) as payload;
`);

  return rows[0]?.payload ?? {};
}

function createRestoreSnapshot(input) {
  const latest = input.latest ?? {};
  const payload = {
    previousQuantity: latest.quantity ?? null,
    reason: input.reason,
    restoredEbayAfterTest: true,
  };
  const rows = querySupabaseJson(`
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
) values (
  concat('codex_restore_', replace(gen_random_uuid()::text, '-', '')),
  ${sqlQuote(input.mapping.shopId)},
  ${sqlQuote(input.mapping.id)},
  'SYNCBAY',
  ${sqlQuote(input.itemId)},
  ${sqlQuote(input.mapping.shopifyProductGid)},
  ${sqlQuote(input.mapping.shopifyVariantGid)},
  ${sqlQuote(input.mapping.sku)},
  ${sqlQuote(latest.title ?? null)},
  ${latest.priceAmount == null ? "null" : `${sqlQuote(latest.priceAmount)}::decimal`},
  ${sqlQuote(latest.currency ?? "EUR")},
  ${input.quantity},
  ${sqlQuote(latest.productStatus ?? null)},
  ${sqlQuote(latest.descriptionHash ?? null)},
  ${latest.imageCount == null ? "null" : Number(latest.imageCount)},
  ${jsonSql(payload)},
  now()
)
returning id, quantity, currency, "capturedAt";
`);

  return rows[0] ?? null;
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

function assertVerifiedAvailableQuantity(input) {
  if (input.verifiedAvailableQuantity === input.targetQuantity) return;

  const actual =
    input.verifiedAvailableQuantity === null
      ? "non verificabile"
      : input.verifiedAvailableQuantity;

  throw new Error(
    `Ripristino eBay non confermato per item ${input.itemId}: disponibilità verificata ${actual}, attesa ${input.targetQuantity}. Snapshot SyncBay non scritto.`,
  );
}

function sqlQuote(value) {
  if (value == null) return "null";

  return `'${String(value).replaceAll("'", "''")}'`;
}

function jsonSql(value) {
  return `${sqlQuote(JSON.stringify(value))}::jsonb`;
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
    return {
      accessToken: decryptSecret(connection.encryptedAccessToken),
      refreshed: false,
    };
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

  return {
    accessToken: json.access_token,
    refreshed: true,
  };
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
  return crypto.createHash("sha256").update(requiredEnv("TOKEN_ENCRYPTION_KEY")).digest();
}

function requiredEnv(key) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} non configurata.`);

  return value;
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

function buildReviseInventoryStatusRequest(input) {
  const sku = input.sku?.trim();

  return `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>it_IT</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <InventoryStatus>
    <ItemID>${escapeXml(input.itemId)}</ItemID>
    ${sku ? `<SKU>${escapeXml(sku)}</SKU>` : ""}
    <Quantity>${input.quantity}</Quantity>
  </InventoryStatus>
</ReviseInventoryStatusRequest>`;
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

function toNumberOrNull(value) {
  if (value == null) return null;

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

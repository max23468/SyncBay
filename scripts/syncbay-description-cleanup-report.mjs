#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

import { XMLParser } from "fast-xml-parser";

import {
  buildDescriptionCleanupReportRow,
  summarizeDescriptionCleanupReport,
} from "../app/lib/syncbay-description-cleanup.ts";
import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";
import { selectTokenEncryptionKey } from "./syncbay-token-key-source.mjs";

const DEFAULT_SAMPLE_LIMIT = 20;
const DEFAULT_MARKETPLACE_ID = "EBAY_IT";
const TOKEN_ENCRYPTION_KEYCHAIN_SERVICE = "syncbay-token-encryption-key";
const TRADING_API_COMPATIBILITY_LEVEL = "1453";
const TRADING_API_BASE_URLS = {
  production: "https://api.ebay.com/ws/api.dll",
  sandbox: "https://api.sandbox.ebay.com/ws/api.dll",
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

const args = parseArgs(process.argv.slice(2));
loadDotEnv(".env");
if (process.env.SYNCBAY_SUPABASE_CWD) {
  loadDotEnv(`${process.env.SYNCBAY_SUPABASE_CWD}/.env`);
}
args.shop = resolveRequiredShopDomainOption({
  args,
  env: process.env,
});
ensureTokenEncryptionKey();

await main().catch((error) => {
  console.error(`Report pulizia descrizioni non riuscito: ${error.message}`);
  process.exit(1);
});

async function main() {
  const state = await getReportState();

  if (!state.connection) {
    throw new Error(`Connessione eBay ${args.marketplaceId} non trovata.`);
  }

  const accessToken = await getAccessToken(state.connection);
  const rows = [];

  for (const candidate of state.candidates) {
    const item = await getTradingItem({
      accessToken,
      connection: state.connection,
      itemId: candidate.ebayItemId,
    });

    rows.push(
      buildDescriptionCleanupReportRow({
        descriptionHtml: getString(item, "Description"),
        itemId: candidate.ebayItemId,
        title: candidate.title,
      }),
    );
  }

  const report = {
    shopDomain: args.shop,
    marketplaceId: args.marketplaceId,
    summary: summarizeDescriptionCleanupReport(rows),
    rows,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printReport(report);
}

async function getReportState() {
  const sql = `
with shop_row as (
  select id from "Shop" where "shopDomain" = ${sqlQuote(args.shop)} limit 1
),
connection as (
  select ec.*
  from "EbayConnection" ec
  join shop_row s on s.id = ec."shopId"
  where ec."marketplaceId" = ${sqlQuote(args.marketplaceId)}
    and ec.status = 'CONNECTED'
  limit 1
),
candidates as (
  select
    pm."ebayItemId",
    coalesce(ps.title, pm."ebayItemId") as title
  from "ProductMapping" pm
  join shop_row s on s.id = pm."shopId"
  left join lateral (
    select title
    from "ProductSnapshot" ps
    where ps."mappingId" = pm.id
      and ps.title is not null
    order by ps."capturedAt" desc
    limit 1
  ) ps on true
  where pm."marketplaceId" = ${sqlQuote(args.marketplaceId)}
    and pm.status in ('ACTIVE', 'OUT_OF_STOCK')
  order by pm."updatedAt" desc
  limit ${args.sample}
)
select jsonb_build_object(
  'connection', (select to_jsonb(connection) from connection),
  'candidates', coalesce((select jsonb_agg(to_jsonb(candidates)) from candidates), '[]'::jsonb)
) as payload;
`;
  const rows = await querySupabaseJson(sql);
  const payload = rows[0]?.payload ?? {};

  return {
    candidates: Array.isArray(payload.candidates) ? payload.candidates : [],
    connection: payload.connection ?? null,
  };
}

async function querySupabaseJson(sql) {
  const result = spawnSync(
    "npx",
    ["supabase", "db", "query", "--linked", "--output", "json", sql],
    {
      cwd: process.env.SYNCBAY_SUPABASE_CWD ?? process.cwd(),
      encoding: "utf8",
      env: {
        ...(await getSupabaseCliEnv()),
        SUPABASE_TELEMETRY_DISABLED: "1",
      },
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

async function getAccessToken(connection) {
  const expiresAt = connection.tokenExpiresAt
    ? new Date(connection.tokenExpiresAt)
    : null;

  if (
    connection.encryptedAccessToken &&
    expiresAt &&
    expiresAt.getTime() > Date.now() + 5 * 60 * 1000
  ) {
    return decryptSecret(connection.encryptedAccessToken);
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

  await querySupabaseJson(`
update "EbayConnection"
set "encryptedAccessToken" = ${sqlQuote(encryptSecret(json.access_token))},
    "lastRefreshAt" = now(),
    "tokenExpiresAt" = ${sqlQuote(tokenExpiresAt.toISOString())}::timestamp,
    "scopes" = coalesce(${sqlQuote(json.scope ?? null)}, "scopes"),
    "updatedAt" = now()
where id = ${sqlQuote(connection.id)}
returning id;
`);

  return json.access_token;
}

function printReport(report) {
  console.log(`Shop: ${report.shopDomain}`);
  console.log(`Marketplace: ${report.marketplaceId}`);
  console.log(
    `Campione: ${report.summary.sampledCount}; cambiati: ${report.summary.changedCount}; ` +
      `rimozione media: ${report.summary.averageRemovedPercent}%; massima: ${report.summary.maxRemovedPercent}%.`,
  );
  console.log(`Segnali template trovati: ${report.summary.templateSignalCount}`);
  console.log("");

  for (const row of report.rows) {
    console.log(`- ${row.itemId} | ${row.title}`);
    console.log(
      `  ${row.rawLength} -> ${row.cleanedLength} caratteri (-${row.removedPercent}%), segnali template ${row.templateSignalCount}.`,
    );
    console.log(`  Pulita: ${row.cleanedTextExcerpt || "vuota"}`);
  }
}

function parseArgs(rawArgs) {
  const parsed = {
    json: false,
    marketplaceId: DEFAULT_MARKETPLACE_ID,
    sample: DEFAULT_SAMPLE_LIMIT,
    shop: null,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--marketplace") {
      parsed.marketplaceId = rawArgs[index + 1] ?? parsed.marketplaceId;
      index += 1;
      continue;
    }

    if (arg === "--sample") {
      parsed.sample = parsePositiveInteger(
        rawArgs[index + 1],
        DEFAULT_SAMPLE_LIMIT,
      );
      index += 1;
      continue;
    }

    if (arg === "--shop") {
      parsed.shop = rawArgs[index + 1] ?? parsed.shop;
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

function printUsage() {
  console.log(`Uso: npm run descriptions:cleanup-report -- [--shop dominio.myshopify.com] [--sample 20] [--json]

Esegue un dry-run read-only su un campione di listing eBay collegati e stampa
solo metriche ed estratti sicuri della descrizione pulita.`);
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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

function decryptSecret(secret) {
  const [version, encodedIv, encodedAuthTag, encodedCiphertext] =
    secret.split(".");
  if (version !== "v1" || !encodedIv || !encodedAuthTag || !encodedCiphertext) {
    throw new Error("Formato token cifrato non valido.");
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

function requiredEnv(key) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} non configurata.`);

  return value;
}

function getTradingBaseUrl(environment) {
  return environment === "production"
    ? TRADING_API_BASE_URLS.production
    : TRADING_API_BASE_URLS.sandbox;
}

function getTokenUrl(environment) {
  return environment === "production"
    ? "https://api.ebay.com/identity/v1/oauth2/token"
    : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";
}

function getTradingSiteId(marketplaceId) {
  if (marketplaceId === "EBAY_IT") return "101";

  return "0";
}

function sqlQuote(value) {
  if (value === null || value === undefined) return "null";

  return `'${String(value).replaceAll("'", "''")}'`;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function getString(record, key) {
  const value = asRecord(record)?.[key];
  if (typeof value === "string") return value.trim() || null;
  if (
    value &&
    typeof value === "object" &&
    typeof value["#text"] === "string"
  ) {
    return value["#text"].trim() || null;
  }

  return null;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

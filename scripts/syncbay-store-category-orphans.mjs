#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

import { XMLParser } from "fast-xml-parser";

import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";
import { selectTokenEncryptionKey } from "./syncbay-token-key-source.mjs";

const TRADING_API_COMPATIBILITY_LEVEL = "1453";
const TOKEN_ENCRYPTION_KEYCHAIN_SERVICE = "syncbay-token-encryption-key";
const GET_ITEM_CONCURRENCY = 4;

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
  console.error(`Diagnostica categoria negozio non riuscita: ${error.message}`);
  process.exit(1);
});

async function main() {
  const state = getDiagnosticState();

  if (!state.connection) {
    throw new Error(`Nessuna connessione eBay attiva per ${shopDomain}.`);
  }

  const allMappings = Array.isArray(state.mappings) ? state.mappings : [];
  const mappings = args.limit ? allMappings.slice(0, args.limit) : allMappings;

  if (mappings.length === 0) {
    throw new Error("Nessun mapping ACTIVE da analizzare.");
  }

  const { accessToken } = await getAccessToken(state.connection);
  const results = await mapWithConcurrency(
    mappings,
    GET_ITEM_CONCURRENCY,
    async (mapping) => {
      try {
        const item = await getTradingItem({
          accessToken,
          connection: state.connection,
          itemId: mapping.ebayItemId,
        });
        const storefront = getStorefrontCategory(asRecord(item?.Storefront));

        return {
          ebayItemId: mapping.ebayItemId,
          sku: mapping.sku ?? null,
          shopifyProductGid: mapping.shopifyProductGid ?? null,
          title: getString(item, "Title"),
          storeCategoryId: storefront.storeCategoryId,
          storeCategoryName: storefront.storeCategoryName,
          ok: true,
        };
      } catch (error) {
        return {
          ebayItemId: mapping.ebayItemId,
          sku: mapping.sku ?? null,
          shopifyProductGid: mapping.shopifyProductGid ?? null,
          title: null,
          storeCategoryId: null,
          storeCategoryName: null,
          ok: false,
          errorMessage: error.message,
        };
      }
    },
  );

  const checked = results.filter((row) => row.ok);
  const failed = results.filter((row) => !row.ok);
  const orphans = checked.filter((row) => row.storeCategoryId === null);

  const report = {
    shopDomain,
    activeMappingsTotal: allMappings.length,
    analyzed: mappings.length,
    checkedOk: checked.length,
    lookupFailed: failed.length,
    withStoreCategory: checked.length - orphans.length,
    withoutStoreCategory: orphans.length,
    partial: Boolean(args.limit && args.limit < allMappings.length),
    orphans: orphans.map((row) => ({
      ebayItemId: row.ebayItemId,
      sku: row.sku,
      title: row.title,
    })),
    failures: failed.map((row) => ({
      ebayItemId: row.ebayItemId,
      errorMessage: row.errorMessage,
    })),
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
mappings as (
  select pm."ebayItemId", pm.sku, pm."shopifyProductGid"
  from "ProductMapping" pm
  join shop_row s on s.id = pm."shopId"
  where pm.status = 'ACTIVE'
  order by pm."ebayItemId"
)
select jsonb_build_object(
  'connection', (select to_jsonb(connection) from connection),
  'mappings', coalesce((select jsonb_agg(to_jsonb(mappings)) from mappings), '[]'::jsonb)
) as payload;
`);

  return rows[0]?.payload ?? {};
}

function getStorefrontCategory(storefront) {
  const record = asRecord(storefront);
  if (!record) return { storeCategoryId: null, storeCategoryName: null };

  const rawId = getString(record, "StoreCategoryID");
  const normalizedId =
    rawId && rawId !== "0" && rawId !== "-999" ? rawId : null;
  const name = getString(record, "StoreCategoryName");

  return {
    storeCategoryId: normalizedId,
    storeCategoryName: normalizedId && name && name.length > 0 ? name : null,
  };
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
  console.log(`Letti con successo: ${report.checkedOk}`);
  console.log(`Lookup falliti: ${report.lookupFailed}`);
  console.log(`Con categoria negozio: ${report.withStoreCategory}`);
  console.log(`Senza categoria negozio: ${report.withoutStoreCategory}`);
  console.log("");

  if (report.orphans.length > 0) {
    console.log("Listing attivi senza categoria del negozio:");
    for (const orphan of report.orphans) {
      console.log(
        `- ItemID ${orphan.ebayItemId}${orphan.sku ? ` · SKU ${orphan.sku}` : ""}${orphan.title ? ` · ${orphan.title}` : ""}`,
      );
    }
    console.log("");
  } else {
    console.log("Nessun listing attivo senza categoria del negozio nel campione.");
    console.log("");
  }

  if (report.failures.length > 0) {
    console.log("Lookup eBay falliti (riprovare):");
    for (const failure of report.failures) {
      console.log(`- ItemID ${failure.ebayItemId}: ${failure.errorMessage}`);
    }
  }
}

function parseArgs(rawArgs) {
  const parsed = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--json") {
      parsed.json = true;
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
  console.log(`Uso: npm run ebay:store-category-orphans -- [--shop dominio.myshopify.com] [--limit N] [--json]

Diagnostica in sola lettura: per ogni mapping ACTIVE chiama eBay Trading API
GetItem e segnala i listing attivi senza categoria del negozio (quelli non
visibili nella vetrina pubblica eBay). Non scrive su eBay e non modifica i dati
prodotto; aggiorna solo il token eBay cifrato se scaduto. Non stampa segreti.

  --limit N   Analizza solo i primi N mapping (lista parziale rapida).`);
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

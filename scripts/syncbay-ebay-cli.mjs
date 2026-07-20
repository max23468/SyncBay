// Helper condivisi per gli script CLI che parlano con eBay (OAuth + Trading
// API) e con i token cifrati SyncBay. Prima vivevano copiati in ogni script.
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { XMLParser } from "fast-xml-parser";

import { querySupabaseJson, sqlQuote } from "./supabase-cli-env.mjs";
import { selectTokenEncryptionKey } from "./syncbay-token-key-source.mjs";

const TRADING_API_COMPATIBILITY_LEVEL = "1453";
const TOKEN_ENCRYPTION_KEYCHAIN_SERVICE = "syncbay-token-encryption-key";

export const tradingXmlParser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  removeNSPrefix: true,
  textNodeName: "#text",
  trimValues: true,
});

export function loadDotEnv(path = ".env") {
  if (!existsSync(path)) return;

  // Come i vecchi loader manuali: le variabili già presenti vincono.
  process.loadEnvFile(path);
}

export function requiredEnv(key) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} non configurata.`);

  return value;
}

export function readKeychainSecret(service) {
  if (process.platform !== "darwin") return null;

  const result = spawnSync("security", ["find-generic-password", "-s", service, "-w"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;

  return result.stdout.replace(/\r?\n$/, "");
}

export function ensureTokenEncryptionKey() {
  const selected = selectTokenEncryptionKey({
    envValue: process.env.TOKEN_ENCRYPTION_KEY,
    keychainValue: readKeychainSecret(TOKEN_ENCRYPTION_KEYCHAIN_SERVICE),
  });

  if (selected.value) {
    process.env.TOKEN_ENCRYPTION_KEY = selected.value;
    return selected.value;
  }

  throw new Error(
    `TOKEN_ENCRYPTION_KEY non configurata e segreto Portachiavi mancante: ${TOKEN_ENCRYPTION_KEYCHAIN_SERVICE}.`,
  );
}

function getTokenKey() {
  return crypto.createHash("sha256").update(requiredEnv("TOKEN_ENCRYPTION_KEY").trim()).digest();
}

export function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getTokenKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(secret) {
  const [version, encodedIv, encodedAuthTag, encodedCiphertext] = secret.split(".");
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

export function getTokenUrl(environment) {
  return environment === "production"
    ? "https://api.ebay.com/identity/v1/oauth2/token"
    : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";
}

export async function getAccessToken(connection) {
  const expiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt) : null;

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
    throw new Error(json.error_description ?? json.error ?? "Refresh token eBay non riuscito.");
  }

  const tokenExpiresAt = new Date(Date.now() + Number(json.expires_in ?? 7200) * 1000);
  const encryptedAccessToken = encryptSecret(json.access_token);

  await querySupabaseJson(`
update "EbayConnection"
set "encryptedAccessToken" = ${sqlQuote(encryptedAccessToken)},
    "lastRefreshAt" = now(),
    "tokenExpiresAt" = ${sqlQuote(tokenExpiresAt.toISOString())}::timestamp,
    "scopes" = coalesce(${sqlQuote(json.scope ?? null)}, "scopes"),
    "updatedAt" = now()
where id = ${sqlQuote(connection.id)}
returning id;
`);

  return { accessToken: json.access_token, refreshed: true };
}

export function decryptIfEnvelope(value) {
  return typeof value === "string" && value.startsWith("v1.") ? decryptSecret(value) : value;
}

export async function getShopifyAccessToken(session, shopDomain) {
  if (!session?.accessToken) {
    throw new Error(`Sessione offline Shopify non disponibile per ${shopDomain}.`);
  }

  const expiresAt = session.expires ? new Date(session.expires) : null;
  if (!expiresAt || expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return decryptIfEnvelope(session.accessToken);
  }

  if (!session.refreshToken) {
    throw new Error("Sessione offline Shopify scaduta senza refresh token: riapri l'app Shopify.");
  }

  const refreshTokenExpiresAt = session.refreshTokenExpires
    ? new Date(session.refreshTokenExpires)
    : null;
  if (refreshTokenExpiresAt && refreshTokenExpiresAt.getTime() <= Date.now()) {
    throw new Error("Refresh token Shopify offline scaduto: riapri l'app Shopify.");
  }

  const response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    body: JSON.stringify({
      client_id: requiredEnv("SHOPIFY_API_KEY"),
      client_secret: requiredEnv("SHOPIFY_API_SECRET"),
      grant_type: "refresh_token",
      refresh_token: decryptIfEnvelope(session.refreshToken),
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const json = await response.json().catch(() => null);

  if (!response.ok || !json?.access_token) {
    throw new Error(`Refresh token Shopify offline non riuscito (HTTP ${response.status}).`);
  }

  const expiresAtNext = new Date(Date.now() + Number(json.expires_in ?? 3600) * 1000);
  const refreshTokenExpiresAtNext = json.refresh_token_expires_in
    ? new Date(Date.now() + Number(json.refresh_token_expires_in) * 1000)
    : null;

  // I token sessione restano cifrati a riposo anche quando il refresh parte
  // dalla CLI: il runtime rifiuta le sessioni in chiaro.
  await querySupabaseJson(`
update "Session"
set "accessToken" = ${sqlQuote(encryptSecret(json.access_token))},
    expires = ${sqlQuote(expiresAtNext.toISOString())}::timestamp,
    "refreshToken" = coalesce(${sqlQuote(json.refresh_token ? encryptSecret(json.refresh_token) : null)}, "refreshToken"),
    "refreshTokenExpires" = coalesce(${sqlQuote(refreshTokenExpiresAtNext?.toISOString() ?? null)}::timestamp, "refreshTokenExpires"),
    scope = coalesce(${sqlQuote(json.scope ?? null)}, scope)
where id = ${sqlQuote(session.id)}
returning id;
`);

  return json.access_token;
}

export function getTradingBaseUrl(environment) {
  return environment === "production"
    ? "https://api.ebay.com/ws/api.dll"
    : "https://api.sandbox.ebay.com/ws/api.dll";
}

export function getTradingSiteId(marketplaceId) {
  if (marketplaceId === "EBAY_IT") return "101";

  throw new Error(`Marketplace Trading API non supportato: ${marketplaceId}.`);
}

export async function tradingCall(input) {
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

  const parsed = tradingXmlParser.parse(responseText);
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

export async function getTradingItem(input) {
  const body = await tradingCall({
    accessToken: input.accessToken,
    callName: "GetItem",
    connection: input.connection,
    requestXml: `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnAll</DetailLevel>
  <ErrorLanguage>it_IT</ErrorLanguage>
  <WarningLevel>High</WarningLevel>${
    input.includeItemSpecifics ? "\n  <IncludeItemSpecifics>true</IncludeItemSpecifics>" : ""
  }
  <ItemID>${escapeXml(input.itemId)}</ItemID>
</GetItemRequest>`,
  });

  return asRecord(body.Item);
}

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function getString(record, key) {
  const value = asRecord(record)?.[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  const nested = asRecord(value);
  const text = nested?.["#text"];

  return typeof text === "string" || typeof text === "number" ? String(text) : null;
}

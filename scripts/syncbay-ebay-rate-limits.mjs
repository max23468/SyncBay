#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";
import { selectTokenEncryptionKey } from "./syncbay-token-key-source.mjs";

const DEFAULT_MARKETPLACE_ID = "EBAY_IT";
const DEFAULT_OAUTH_BASE_URL = "https://api.ebay.com";
const DEFAULT_ANALYTICS_BASE_URL = "https://api.ebay.com";
const DEFAULT_ANALYTICS_SCOPE = "https://api.ebay.com/oauth/api_scope";
const TOKEN_ENCRYPTION_KEYCHAIN_SERVICE = "syncbay-token-encryption-key";

function loadDotEnv(path = ".env") {
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

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv) {
  const args = {
    all: false,
    json: false,
    marketplaceId: DEFAULT_MARKETPLACE_ID,
    shop: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--all") {
      args.all = true;
      continue;
    }

    if (arg === "--json") {
      args.json = true;
      continue;
    }

    if (arg === "--shop") {
      args.shop = argv[index + 1] ?? args.shop;
      index += 1;
      continue;
    }

    if (arg === "--marketplace") {
      args.marketplaceId = argv[index + 1] ?? args.marketplaceId;
      index += 1;
      continue;
    }

    throw new Error(`Opzione non riconosciuta: ${arg}`);
  }

  return args;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${
        result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`
      }`,
    );
  }

  return result.stdout;
}

async function querySupabaseJson(sql) {
  const stdout = runCommand(
    "npx",
    ["supabase", "db", "query", "--linked", "--output", "json", sql],
    {
      env: await getSupabaseCliEnv(),
    },
  );

  const jsonStart = findJsonStart(stdout);

  if (jsonStart < 0) {
    throw new Error("Supabase CLI non ha restituito JSON.");
  }

  const parsed = JSON.parse(stdout.slice(jsonStart));
  const rows = Array.isArray(parsed) ? parsed : parsed.rows;

  if (!Array.isArray(rows)) {
    throw new Error("Output Supabase inatteso: rows non e' un array JSON.");
  }

  return rows;
}

function findJsonStart(value) {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");

  if (objectStart < 0) return arrayStart;
  if (arrayStart < 0) return objectStart;

  return Math.min(objectStart, arrayStart);
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function getOauthBaseUrl(mode) {
  return mode === "SANDBOX"
    ? "https://api.sandbox.ebay.com"
    : DEFAULT_OAUTH_BASE_URL;
}

function getAnalyticsBaseUrl(mode) {
  return mode === "SANDBOX"
    ? "https://api.sandbox.ebay.com"
    : DEFAULT_ANALYTICS_BASE_URL;
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

function createTokenCipher(key) {
  const decoded = crypto.createHash("sha256").update(key).digest();

  return {
    decrypt(secret) {
      const [version, encodedIv, encodedAuthTag, encodedCiphertext] =
        secret.split(".");

      if (
        version !== "v1" ||
        !encodedIv ||
        !encodedAuthTag ||
        !encodedCiphertext
      ) {
        throw new Error("Formato token cifrato non valido.");
      }

      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        decoded,
        Buffer.from(encodedIv, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(encodedAuthTag, "base64url"));

      return Buffer.concat([
        decipher.update(Buffer.from(encodedCiphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    },
    encrypt(value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", decoded, iv);
      const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();

      return [
        "v1",
        iv.toString("base64url"),
        authTag.toString("base64url"),
        encrypted.toString("base64url"),
      ].join(".");
    },
  };
}

async function getShopState(shopDomain, marketplaceId) {
  const rows = await querySupabaseJson(`
with target_shop as (
  select id, "shopDomain"
  from "Shop"
  where "shopDomain" = ${sqlQuote(shopDomain)}
  limit 1
),
target_connection as (
  select ec.*
  from "EbayConnection" ec
  join target_shop s on s.id = ec."shopId"
  where ec."marketplaceId" = ${sqlQuote(marketplaceId)}
  order by ec."updatedAt" desc
  limit 1
),
latest_incremental_failure as (
  select
    id,
    "createdAt",
    "runAfter",
    "finishedAt",
    result,
    "errorMessage"
  from "SyncJob"
  where
    "shopId" = (select id from target_shop)
    and type = 'SYNC_INCREMENTAL'
    and "errorCode" = 'SYNCBAY_INCREMENTAL_ENQUEUE_FAILED'
  order by "createdAt" desc
  limit 1
)
select jsonb_build_object(
  'shop', (select to_jsonb(target_shop) from target_shop),
  'connection', (select to_jsonb(target_connection) from target_connection),
  'latestIncrementalFailure', (select to_jsonb(latest_incremental_failure) from latest_incremental_failure)
) as payload;
`);

  const payload = rows[0]?.payload;

  if (!payload?.shop) {
    throw new Error(`Shop ${shopDomain} non trovato in Supabase.`);
  }

  if (!payload?.connection) {
    throw new Error(`Connessione eBay ${marketplaceId} non trovata per ${shopDomain}.`);
  }

  return payload;
}

async function updateAccessToken(connectionId, accessToken, expiresAt, tokenCipher) {
  const encryptedAccessToken = tokenCipher.encrypt(accessToken);

  await querySupabaseJson(`
update "EbayConnection"
set
  "encryptedAccessToken" = ${sqlQuote(encryptedAccessToken)},
  "tokenExpiresAt" = ${sqlQuote(expiresAt)},
  "lastRefreshAt" = now(),
  "updatedAt" = now()
where id = ${sqlQuote(connectionId)}
returning id;
`);
}

async function refreshAccessToken(connection, tokenCipher) {
  const refreshToken = tokenCipher.decrypt(connection.encryptedRefreshToken);
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("EBAY_CLIENT_ID e EBAY_CLIENT_SECRET sono necessari per aggiornare il token eBay.");
  }

  const response = await fetch(`${getOauthBaseUrl(connection.environment)}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: connection.scopes,
    }),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok || typeof body.access_token !== "string") {
    throw new Error(`Refresh token eBay fallito (${response.status}).`);
  }

  const expiresAt = new Date(Date.now() + Number(body.expires_in ?? 0) * 1000).toISOString();
  await updateAccessToken(connection.id, body.access_token, expiresAt, tokenCipher);

  return {
    accessToken: body.access_token,
    refreshed: true,
  };
}

async function getAccessToken(connection, tokenCipher) {
  const expiresAt = connection.tokenExpiresAt
    ? new Date(connection.tokenExpiresAt).getTime()
    : 0;

  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > 60_000) {
    return {
      accessToken: tokenCipher.decrypt(connection.encryptedAccessToken),
      refreshed: false,
    };
  }

  return refreshAccessToken(connection, tokenCipher);
}

async function getApplicationAccessToken(mode) {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("EBAY_CLIENT_ID e EBAY_CLIENT_SECRET sono necessari per leggere i limiti applicativi eBay.");
  }

  const response = await fetch(`${getOauthBaseUrl(mode)}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: process.env.EBAY_ANALYTICS_RATE_LIMIT_SCOPE ?? DEFAULT_ANALYTICS_SCOPE,
    }),
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok || typeof body.access_token !== "string") {
    throw new Error(`Token applicativo eBay fallito (${response.status}).`);
  }

  return body.access_token;
}

async function analyticsRateLimitCall({ accessToken, mode, target }) {
  const url = new URL(
    target === "application"
      ? "/developer/analytics/v1_beta/rate_limit/"
      : "/developer/analytics/v1_beta/user_rate_limit/",
    getAnalyticsBaseUrl(mode),
  );
  url.searchParams.set("api_name", "tradingapi");
  url.searchParams.set("api_context", "tradingapi");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(
      `Analytics API rate limit fallita (${response.status}): ${JSON.stringify(body).slice(0, 500)}`,
    );
  }

  return body;
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function mapRateLimitResource(rateLimit, resource) {
  return {
    apiContext: rateLimit.apiContext ?? null,
    apiName: rateLimit.apiName ?? null,
    apiVersion: rateLimit.apiVersion ?? null,
    resourceName: resource.name ?? "unknown",
    rates: normalizeArray(resource.rates).map((rate) => ({
      count: rate.count ?? null,
      limit: rate.limit ?? null,
      remaining: rate.remaining ?? null,
      reset: rate.reset ?? null,
      timeWindow: rate.timeWindow ?? null,
    })),
  };
}

function selectRules(resources, includeAll) {
  if (includeAll) return resources;

  const relevantNames = [
    "GetItem",
    "GetMyeBaySelling",
    "GetSellerEvents",
    "ReviseInventoryStatus",
  ].map((name) => name.toLowerCase());
  const selected = resources.filter((resource) =>
    relevantNames.some((name) => resource.resourceName.toLowerCase().includes(name)),
  );

  return selected.length > 0 ? selected : resources.slice(0, 20);
}

function mapRateLimitResources(body, source) {
  return normalizeArray(body.rateLimits).flatMap((rateLimit) =>
    normalizeArray(rateLimit.resources).map((resource) =>
      ({
        ...mapRateLimitResource(rateLimit, resource),
        source,
      }),
    ),
  );
}

function buildSummary({
  applicationBody,
  applicationError,
  args,
  latestIncrementalFailure,
  tokenRefreshed,
  userBody,
}) {
  const applicationResources = applicationBody
    ? mapRateLimitResources(applicationBody, "application")
    : [];
  const userResources = mapRateLimitResources(userBody, "user");
  const resources = [...applicationResources, ...userResources];
  const selectedRules = selectRules(resources, args.all);

  return {
    shop: args.shop,
    marketplaceId: args.marketplaceId,
    checkedAt: new Date().toISOString(),
    applicationRateLimitError: applicationError,
    applicationRuleCount: applicationResources.length,
    tokenRefreshed,
    userRuleCount: userResources.length,
    ruleCount: resources.length,
    rules: selectedRules,
    latestIncrementalFailure: latestIncrementalFailure
      ? {
          id: latestIncrementalFailure.id,
          createdAt: latestIncrementalFailure.createdAt,
          runAfter: latestIncrementalFailure.runAfter,
          finishedAt: latestIncrementalFailure.finishedAt,
          rateLimitCooldownSeconds:
            latestIncrementalFailure.result?.rateLimitCooldownSeconds ?? null,
          retryScheduledAt:
            latestIncrementalFailure.result?.retryScheduledAt ?? null,
          error: latestIncrementalFailure.errorMessage ?? null,
        }
      : null,
  };
}

function printTextSummary(summary) {
  console.log(`Shop: ${summary.shop}`);
  console.log(`Marketplace: ${summary.marketplaceId}`);
  console.log(`Controllo: ${summary.checkedAt}`);
  console.log(`Token eBay aggiornato: ${summary.tokenRefreshed ? "si" : "no"}`);
  console.log(
    `Regole Trading API lette: app ${summary.applicationRuleCount}, utente ${summary.userRuleCount}`,
  );

  if (summary.applicationRateLimitError) {
    console.log(`Limiti applicativi non letti: ${summary.applicationRateLimitError}`);
  }

  if (summary.latestIncrementalFailure) {
    console.log("");
    console.log("Ultimo marker SyncBay di rate/backoff:");
    console.log(`- creato: ${summary.latestIncrementalFailure.createdAt}`);
    console.log(`- riprova da: ${summary.latestIncrementalFailure.runAfter}`);
    console.log(
      `- cooldown: ${summary.latestIncrementalFailure.rateLimitCooldownSeconds ?? "n/d"}s`,
    );
  }

  console.log("");
  console.log("Regole principali:");

  for (const rule of summary.rules) {
    console.log(`- ${rule.resourceName} (${rule.source})`);
    console.log(`  api: ${rule.apiContext ?? "n/d"}/${rule.apiName ?? "n/d"} ${rule.apiVersion ?? ""}`.trim());
    for (const rate of rule.rates) {
      console.log(
        `  finestra ${rate.timeWindow ?? "n/d"}s: usate ${rate.count ?? "n/d"}, limite ${rate.limit ?? "n/d"}, residue ${rate.remaining ?? "n/d"}, reset ${rate.reset ?? "n/d"}`,
      );
    }
  }

  if (summary.ruleCount === 0) {
    console.log("Nessuna regola Trading API trovata nella risposta Analytics.");
  }
}

async function main() {
  loadDotEnv(".env");
  const args = parseArgs(process.argv.slice(2));
  args.shop = resolveRequiredShopDomainOption({
    args,
    env: process.env,
  });
  const tokenCipher = createTokenCipher(ensureTokenEncryptionKey());
  const state = await getShopState(args.shop, args.marketplaceId);

  if (state.connection.status !== "CONNECTED") {
    throw new Error(`Connessione eBay non CONNECTED: ${state.connection.status}`);
  }

  const { accessToken, refreshed } = await getAccessToken(
    state.connection,
    tokenCipher,
  );
  const userBody = await analyticsRateLimitCall({
    accessToken,
    mode: state.connection.environment,
    target: "user",
  });
  let applicationBody = null;
  let applicationError = null;

  try {
    const applicationAccessToken = await getApplicationAccessToken(
      state.connection.environment,
    );
    applicationBody = await analyticsRateLimitCall({
      accessToken: applicationAccessToken,
      mode: state.connection.environment,
      target: "application",
    });
  } catch (error) {
    applicationError = error instanceof Error ? error.message : String(error);
  }

  const summary = buildSummary({
    args,
    applicationBody,
    applicationError,
    latestIncrementalFailure: state.latestIncrementalFailure,
    tokenRefreshed: refreshed,
    userBody,
  });

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  printTextSummary(summary);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

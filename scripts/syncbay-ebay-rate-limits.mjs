#!/usr/bin/env node

import { parseArgs as parseNodeArgs } from "node:util";

import { getEbayApiBaseUrl } from "../app/services/ebay-environment.server.ts";
import { requestEbayOAuthToken } from "../app/services/ebay-oauth.server.ts";
import { querySupabaseJson, sqlQuote } from "./supabase-cli-env.mjs";
import { ensureTokenEncryptionKey, getAccessToken, loadDotEnv } from "./syncbay-ebay-cli.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";

const DEFAULT_MARKETPLACE_ID = "EBAY_IT";
const DEFAULT_ANALYTICS_SCOPE = "https://api.ebay.com/oauth/api_scope";

function parseArgs(argv) {
  const { values } = parseNodeArgs({
    args: argv,
    options: {
      all: { type: "boolean" },
      json: { type: "boolean" },
      marketplace: { type: "string" },
      shop: { type: "string" },
    },
  });

  return {
    all: values.all ?? false,
    json: values.json ?? false,
    marketplaceId: values.marketplace ?? DEFAULT_MARKETPLACE_ID,
    shop: values.shop ?? null,
  };
}

async function getShopState(shopDomain, marketplaceId) {
  const { rows } = await querySupabaseJson(`
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

async function getApplicationAccessToken(mode) {
  const token = await requestEbayOAuthToken({
    environment: mode,
    grant: {
      scope: process.env.EBAY_ANALYTICS_RATE_LIMIT_SCOPE ?? DEFAULT_ANALYTICS_SCOPE,
      type: "client_credentials",
    },
  });

  return token.accessToken;
}

async function analyticsRateLimitCall({ accessToken, mode, target }) {
  const url = new URL(
    target === "application"
      ? "/developer/analytics/v1_beta/rate_limit/"
      : "/developer/analytics/v1_beta/user_rate_limit/",
    getEbayApiBaseUrl(mode),
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
    normalizeArray(rateLimit.resources).map((resource) => ({
      ...mapRateLimitResource(rateLimit, resource),
      source,
    })),
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
          retryScheduledAt: latestIncrementalFailure.result?.retryScheduledAt ?? null,
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
    console.log(
      `  api: ${rule.apiContext ?? "n/d"}/${rule.apiName ?? "n/d"} ${rule.apiVersion ?? ""}`.trim(),
    );
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
  ensureTokenEncryptionKey();
  const state = await getShopState(args.shop, args.marketplaceId);

  if (state.connection.status !== "CONNECTED") {
    throw new Error(`Connessione eBay non CONNECTED: ${state.connection.status}`);
  }

  const { accessToken, refreshed } = await getAccessToken(state.connection);
  const userBody = await analyticsRateLimitCall({
    accessToken,
    mode: state.connection.environment,
    target: "user",
  });
  let applicationBody = null;
  let applicationError = null;

  try {
    const applicationAccessToken = await getApplicationAccessToken(state.connection.environment);
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

#!/usr/bin/env node

import { parseArgs } from "node:util";
import { buildReadinessReport } from "./syncbay-orders-paid-readiness-report.mjs";
import {
  formatCliError,
  querySupabaseJson,
  sqlString,
} from "./supabase-cli-env.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";

const DEFAULT_CANDIDATE_LIMIT = 5;
const ACTIVE_JOB_STATUSES = ["PENDING", "RUNNING", "RETRYING"];

const { values: args } = parseArgs({
  options: {
    help: { short: "h", type: "boolean" },
    json: { type: "boolean" },
    limit: { type: "string" },
    shop: { type: "string" },
  },
});

if (args.help) {
  console.log(`Uso: npm run orders:paid-readiness -- [--shop dominio.myshopify.com] [--limit 5] [--json]

Interroga Supabase remoto in sola lettura e verifica se il runtime orders/paid
e il test automatico via Shopify Admin orderCreate sono pronti. Non stampa token,
segreti o dati cliente.`);
  process.exit(0);
}

const shopDomain = resolveRequiredShopDomainOption({
  args,
  env: process.env,
});
const parsedCandidateLimit = Number.parseInt(args.limit ?? "", 10);
const candidateLimit =
  Number.isInteger(parsedCandidateLimit) && parsedCandidateLimit > 0
    ? parsedCandidateLimit
    : DEFAULT_CANDIDATE_LIMIT;

await main().catch((error) => {
  console.error(`Readiness orders/paid non riuscita: ${formatCliError(error)}`);
  process.exit(1);
});

async function main() {
  const diagnostics = await querySupabaseJson(buildReadinessSql());
  const payload = diagnostics.rows?.[0]?.diagnostics;

  if (!payload) {
    throw new Error("Supabase non ha restituito diagnostics.");
  }

  const report = buildReadinessReport(payload, { shopDomain });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printReport(report);
}

function buildReadinessSql() {
  return `
with shop_row as (
  select *
  from "Shop"
  where "shopDomain" = ${sqlString(shopDomain)}
  limit 1
),
session_row as (
  select
    sess.id,
    sess.shop,
    sess."isOnline",
    sess.expires,
    sess."refreshTokenExpires",
    sess.scope,
    length(coalesce(sess."accessToken", '')) as "accessTokenLength",
    length(coalesce(sess."refreshToken", '')) as "refreshTokenLength"
  from "Session" sess
  where sess.id = 'offline_' || ${sqlString(shopDomain)}
  limit 1
),
ebay_connection_row as (
  select
    ec."marketplaceId",
    ec.status,
    ec."connectedAt",
    ec."tokenExpiresAt",
    ec."refreshTokenExpiresAt",
    ec.scopes,
    length(coalesce(ec."encryptedAccessToken", '')) as "accessTokenLength",
    length(coalesce(ec."encryptedRefreshToken", '')) as "refreshTokenLength"
  from "EbayConnection" ec
  join shop_row s on s.id = ec."shopId"
  where ec."marketplaceId" = 'EBAY_IT'
  limit 1
),
latest_snapshot as (
  select distinct on (ps."mappingId")
    ps."mappingId",
    ps.currency,
    ps.quantity,
    ps."capturedAt",
    ps.source
  from "ProductSnapshot" ps
  join shop_row s on s.id = ps."shopId"
  where ps."mappingId" is not null
  order by ps."mappingId", ps."capturedAt" desc
),
mapping_counts as (
  select
    count(*) filter (where m.status = 'ACTIVE')::int as "activeMappings",
    count(*) filter (
      where m.status = 'ACTIVE'
        and m."shopifyVariantGid" is not null
    )::int as "activeWithVariant",
    count(*) filter (
      where m.status = 'ACTIVE'
        and m."shopifyVariantGid" is not null
        and ls."mappingId" is not null
    )::int as "activeWithLatestSnapshot",
    count(*) filter (
      where m.status = 'ACTIVE'
        and m."shopifyVariantGid" is not null
        and ls.currency = 'EUR'
    )::int as "activeWithEurSnapshot",
    count(*) filter (
      where m.status = 'ACTIVE'
        and m."shopifyVariantGid" is not null
        and ls.currency = 'EUR'
        and coalesce(ls.quantity, 0) > 0
    )::int as "eligibleQuantityPositive"
  from "ProductMapping" m
  join shop_row s on s.id = m."shopId"
  left join latest_snapshot ls on ls."mappingId" = m.id
  where m."marketplaceId" = 'EBAY_IT'
),
candidate_rows as (
  select jsonb_agg(to_jsonb(candidates) order by candidates."snapshotQuantity" desc, candidates."ebayItemId") as rows
  from (
    select
      m."ebayItemId",
      m.sku,
      m."shopifyProductGid",
      m."shopifyVariantGid",
      ls.currency as "snapshotCurrency",
      ls.quantity as "snapshotQuantity",
      ls.source as "snapshotSource",
      ls."capturedAt" as "snapshotCapturedAt"
    from "ProductMapping" m
    join shop_row s on s.id = m."shopId"
    join latest_snapshot ls on ls."mappingId" = m.id
    where m."marketplaceId" = 'EBAY_IT'
      and m.status = 'ACTIVE'
      and m."shopifyVariantGid" is not null
      and ls.currency = 'EUR'
      and coalesce(ls.quantity, 0) > 0
    order by ls.quantity desc, m."ebayItemId"
    limit ${candidateLimit}
  ) candidates
),
queue_counts as (
  select
    count(*) filter (where j.status in (${ACTIVE_JOB_STATUSES.map(sqlString).join(", ")}))::int as "activeJobs",
    count(*) filter (
      where j.status in (${ACTIVE_JOB_STATUSES.map(sqlString).join(", ")})
        and j.type = 'UPDATE_EBAY_STOCK'
    )::int as "activeStockJobs",
    count(*) filter (
      where j.status in (${ACTIVE_JOB_STATUSES.map(sqlString).join(", ")})
        and j.type = 'SYNC_INCREMENTAL'
    )::int as "activeSyncJobs"
  from "SyncJob" j
  join shop_row s on s.id = j."shopId"
),
latest_stock_jobs as (
  select jsonb_agg(to_jsonb(stock_jobs) order by stock_jobs."updatedAt" desc) as rows
  from (
    select
      j.id,
      j.status,
      j.attempts,
      j."createdAt",
      j."updatedAt",
      j."finishedAt",
      j."errorCode",
      left(coalesce(j."errorMessage", ''), 240) as "errorMessage",
      j.result->>'dryRun' as "dryRun",
      j.result->>'plannedCount' as "plannedCount",
      j.result->>'updatedCount' as "updatedCount",
      j.result->>'skippedCount' as "skippedCount"
    from "SyncJob" j
    join shop_row s on s.id = j."shopId"
    where j.type = 'UPDATE_EBAY_STOCK'
    order by j."updatedAt" desc
    limit 5
  ) stock_jobs
),
trading_api_cooldown as (
  select jsonb_build_object(
    'id', j.id,
    'type', j.type,
    'status', j.status,
    'errorCode', j."errorCode",
    'runAfter', j."runAfter",
    'retryScheduledAt', j.result->>'retryScheduledAt',
    'rateLimitCooldownSeconds', j.result->>'rateLimitCooldownSeconds'
  ) as payload
  from "SyncJob" j
  join shop_row s on s.id = j."shopId"
  where j."runAfter" > now()
    and j.type in (
      'IMPORT_CATALOG',
      'SYNC_INCREMENTAL',
      'UPDATE_EBAY_STOCK',
      'ARCHIVE_INACTIVE_LISTING'
    )
    and j."errorCode" in (
      'EBAY_TRADING_RATE_LIMITED',
      'SYNCBAY_INCREMENTAL_ENQUEUE_FAILED'
    )
  order by j."runAfter" asc, j."updatedAt" desc
  limit 1
)
select jsonb_build_object(
  'checkedAt', now(),
  'shop', (
    select jsonb_build_object(
      'id', id,
      'shopDomain', "shopDomain",
      'installationStatus', "installationStatus",
      'shopifyScopes', "shopifyScopes",
      'syncEnabled', "syncEnabled"
    )
    from shop_row
  ),
  'session', (select to_jsonb(session_row) from session_row),
  'ebayConnection', (select to_jsonb(ebay_connection_row) from ebay_connection_row),
  'mappingCounts', (select to_jsonb(mapping_counts) from mapping_counts),
  'candidates', coalesce((select rows from candidate_rows), '[]'::jsonb),
  'queue', (select to_jsonb(queue_counts) from queue_counts),
  'latestStockJobs', coalesce((select rows from latest_stock_jobs), '[]'::jsonb),
  'tradingApiCooldown', (select payload from trading_api_cooldown)
) as diagnostics;
`;
}

function printReport(report) {
  console.log(`Shop: ${report.shopDomain}`);
  console.log(
    `Runtime webhook orders/paid: ${report.webhookRuntimeReady ? "pronto" : "bloccato"}`,
  );
  console.log(
    `Test Admin orderCreate: ${report.adminOrderCreateTestReady ? "pronto" : "bloccato"}`,
  );
  console.log(`Controllato: ${report.checkedAt}`);
  console.log("");
  console.log("Sessione Shopify offline:");
  console.log(`- id: ${report.session.id ?? "non trovata"}`);
  console.log(`- expires: ${report.session.expires ?? "assente"}`);
  console.log(
    `- refreshToken: ${report.session.hasRefreshToken ? "presente" : "assente"}`,
  );
  console.log(
    `- refreshTokenExpires: ${report.session.refreshTokenExpires ?? "assente"}`,
  );
  console.log(
    `- scope: ${report.session.scopes.length > 0 ? report.session.scopes.join(", ") : "assenti"}`,
  );
  console.log("");
  console.log("Connessione eBay:");
  console.log(`- marketplace: ${report.ebayConnection.marketplaceId}`);
  console.log(`- status: ${report.ebayConnection.status ?? "assente"}`);
  console.log(
    `- accessToken: ${report.ebayConnection.hasAccessToken ? "presente" : "assente"}`,
  );
  console.log(
    `- tokenExpiresAt: ${report.ebayConnection.tokenExpiresAt ?? "assente"}`,
  );
  console.log(
    `- refreshToken: ${report.ebayConnection.hasRefreshToken ? "presente" : "assente"}`,
  );
  console.log(
    `- refreshTokenExpiresAt: ${report.ebayConnection.refreshTokenExpiresAt ?? "assente"}`,
  );
  console.log("");
  console.log("Coda:");
  console.log(`- job attivi: ${report.queue?.activeJobs ?? 0}`);
  console.log(
    `- UPDATE_EBAY_STOCK attivi: ${report.queue?.activeStockJobs ?? 0}`,
  );
  console.log(
    `- SYNC_INCREMENTAL attivi: ${report.queue?.activeSyncJobs ?? 0}`,
  );
  console.log("");
  console.log("Mapping idonei al test:");
  console.log(`- attivi: ${report.mappingCounts?.activeMappings ?? 0}`);
  console.log(
    `- attivi con variante Shopify: ${report.mappingCounts?.activeWithVariant ?? 0}`,
  );
  console.log(
    `- attivi con snapshot EUR: ${report.mappingCounts?.activeWithEurSnapshot ?? 0}`,
  );
  console.log(
    `- idonei con quantità positiva: ${report.mappingCounts?.eligibleQuantityPositive ?? 0}`,
  );

  if (report.candidates.length > 0) {
    console.log("");
    console.log("Candidati:");
    for (const candidate of report.candidates) {
      console.log(
        `- eBay ${candidate.ebayItemId}, variante ${candidate.shopifyVariantGid}, quantità ${candidate.snapshotQuantity} ${candidate.snapshotCurrency}, snapshot ${candidate.snapshotCapturedAt}`,
      );
    }
  }

  if (report.webhookRuntimeBlockers.length > 0) {
    console.log("");
    console.log("Blocchi runtime webhook:");
    for (const blocker of report.webhookRuntimeBlockers) {
      console.log(`- ${blocker}`);
    }
  }

  if (report.adminOrderCreateBlockers.length > 0) {
    console.log("");
    console.log("Blocchi test Admin orderCreate:");
    for (const blocker of report.adminOrderCreateBlockers) {
      console.log(`- ${blocker}`);
    }
  }

  console.log("");
  console.log("Ultimi job UPDATE_EBAY_STOCK:");
  for (const job of report.latestStockJobs) {
    const result = [
      job.dryRun ? `dryRun=${job.dryRun}` : null,
      job.plannedCount ? `planned=${job.plannedCount}` : null,
      job.updatedCount ? `updated=${job.updatedCount}` : null,
      job.skippedCount ? `skipped=${job.skippedCount}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    const error = job.errorCode
      ? `, ${job.errorCode}: ${job.errorMessage}`
      : "";
    console.log(
      `- ${job.id}: ${job.status}, tentativi ${job.attempts}, aggiornato ${job.updatedAt}${result ? `, ${result}` : ""}${error}`,
    );
  }

  if (
    report.webhookRuntimeReady &&
    !report.adminOrderCreateTestReady &&
    report.session.scopeMissingForAdminOrderCreate
  ) {
    console.log("");
    console.log(
      "Prossima azione: il runtime può ricevere orders/paid, ma il test automatico via Admin API richiede write_orders. Usa un checkout/admin order manuale sullo store pilota Numisleo oppure aggiungi lo scope e riapri l'app Shopify per ottenere una sessione offline aggiornata.",
    );
  }
}

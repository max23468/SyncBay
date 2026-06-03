#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildReadinessReport } from "./syncbay-orders-paid-readiness-report.mjs";
import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";

const execFileAsync = promisify(execFile);

const DEFAULT_SHOP_DOMAIN = "syncbay-dev.myshopify.com";
const DEFAULT_CANDIDATE_LIMIT = 5;
const ACTIVE_JOB_STATUSES = ["PENDING", "RUNNING", "RETRYING"];

const args = parseArgs(process.argv.slice(2));
const shopDomain =
  args.shop ?? process.env.SHOPIFY_DEV_STORE ?? DEFAULT_SHOP_DOMAIN;
const candidateLimit = args.limit ?? DEFAULT_CANDIDATE_LIMIT;

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
    ec.scopes
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
  'latestStockJobs', coalesce((select rows from latest_stock_jobs), '[]'::jsonb)
) as diagnostics;
`;
}

async function querySupabaseJson(sql) {
  const { stdout } = await execFileAsync(
    "npx",
    ["supabase", "db", "query", "--linked", "--output", "json", sql],
    {
      cwd: process.cwd(),
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
  console.log("");
  console.log("Coda:");
  console.log(`- job attivi: ${report.queue?.activeJobs ?? 0}`);
  console.log(`- UPDATE_EBAY_STOCK attivi: ${report.queue?.activeStockJobs ?? 0}`);
  console.log(`- SYNC_INCREMENTAL attivi: ${report.queue?.activeSyncJobs ?? 0}`);
  console.log("");
  console.log("Mapping idonei al test:");
  console.log(`- attivi: ${report.mappingCounts?.activeMappings ?? 0}`);
  console.log(`- attivi con variante Shopify: ${report.mappingCounts?.activeWithVariant ?? 0}`);
  console.log(`- attivi con snapshot EUR: ${report.mappingCounts?.activeWithEurSnapshot ?? 0}`);
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
    const error = job.errorCode ? `, ${job.errorCode}: ${job.errorMessage}` : "";
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
      "Prossima azione: il runtime può ricevere orders/paid, ma il test automatico via Admin API richiede write_orders. Usa un checkout/admin order manuale sul dev store oppure aggiungi lo scope e riapri l'app Shopify per ottenere una sessione offline aggiornata.",
    );
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

    if (arg === "--shop") {
      parsed.shop = rawArgs[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--limit") {
      const limit = Number.parseInt(rawArgs[index + 1] ?? "", 10);
      parsed.limit = Number.isInteger(limit) && limit > 0 ? limit : undefined;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(`Uso: npm run orders:paid-readiness -- [--shop dominio.myshopify.com] [--limit 5] [--json]

Interroga Supabase remoto in sola lettura e verifica se il runtime orders/paid
e il test automatico via Shopify Admin orderCreate sono pronti. Non stampa token,
segreti o dati cliente.`);
      process.exit(0);
    }

    throw new Error(`Argomento non supportato: ${arg}`);
  }

  return parsed;
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
  return `'${String(value).replaceAll("'", "''")}'`;
}

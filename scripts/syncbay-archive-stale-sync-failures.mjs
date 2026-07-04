#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";

const execFileAsync = promisify(execFile);

const DEFAULT_MAX_AGE_HOURS = 24;
const ARCHIVABLE_ERROR_CODES = [
  "SYNCBAY_INCREMENTAL_BLOCKED",
  "SYNCBAY_INCREMENTAL_ENQUEUE_FAILED",
];

const args = parseArgs(process.argv.slice(2));
const shopDomain = resolveRequiredShopDomainOption({
  args,
  env: process.env,
});
const maxAgeHours = args.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;

await main().catch((error) => {
  console.error(`Archivio job storici non riuscito: ${formatCliError(error)}`);
  process.exit(1);
});

async function main() {
  const payload = await querySupabaseJson(
    args.apply ? buildApplySql() : buildPreviewSql(),
  );
  const result = payload.rows?.[0]?.result ?? {};

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printSummary(result);
}

function buildPreviewSql() {
  return `
with shop as (
  select id, "shopDomain"
  from "Shop"
  where "shopDomain" = ${sqlString(shopDomain)}
),
latest_success as (
  select max(coalesce("finishedAt", "updatedAt")) as completed_at
  from "SyncJob"
  where "shopId" = (select id from shop)
    and type = 'SYNC_INCREMENTAL'
    and status = 'SUCCEEDED'
),
candidates as (
  select j.*
  from "SyncJob" j
  where j."shopId" = (select id from shop)
    and j.type = 'SYNC_INCREMENTAL'
    and j.status = 'FAILED'
    and j."errorCode" in (${ARCHIVABLE_ERROR_CODES.map(sqlString).join(", ")})
    and j."updatedAt" < (select completed_at from latest_success)
    and j."updatedAt" <= now() - (${Number(maxAgeHours)} || ' hours')::interval
)
select jsonb_build_object(
  'mode', 'dry-run',
  'shopDomain', ${sqlString(shopDomain)},
  'latestSuccessfulIncrementalSyncAt', (select completed_at from latest_success),
  'maxAgeHours', ${Number(maxAgeHours)},
  'archivableCount', (select count(*)::int from candidates),
  'byErrorCode', coalesce((
    select jsonb_agg(to_jsonb(grouped) order by grouped."lastUpdatedAt" desc)
    from (
      select
        coalesce("errorCode", 'NO_CODE') as "errorCode",
        count(*)::int as "jobCount",
        min("updatedAt") as "firstUpdatedAt",
        max("updatedAt") as "lastUpdatedAt"
      from candidates
      group by coalesce("errorCode", 'NO_CODE')
    ) grouped
  ), '[]'::jsonb)
) as result;
`;
}

function buildApplySql() {
  return `
with shop as (
  select id, "shopDomain"
  from "Shop"
  where "shopDomain" = ${sqlString(shopDomain)}
),
latest_success as (
  select max(coalesce("finishedAt", "updatedAt")) as completed_at
  from "SyncJob"
  where "shopId" = (select id from shop)
    and type = 'SYNC_INCREMENTAL'
    and status = 'SUCCEEDED'
),
candidates as (
  select j.id
  from "SyncJob" j
  where j."shopId" = (select id from shop)
    and j.type = 'SYNC_INCREMENTAL'
    and j.status = 'FAILED'
    and j."errorCode" in (${ARCHIVABLE_ERROR_CODES.map(sqlString).join(", ")})
    and j."updatedAt" < (select completed_at from latest_success)
    and j."updatedAt" <= now() - (${Number(maxAgeHours)} || ' hours')::interval
),
updated as (
  update "SyncJob" j
  set
    status = 'CANCELLED',
    result = (
      case
        when j.result is null then '{}'::jsonb
        when j.result = 'null'::jsonb then '{}'::jsonb
        when jsonb_typeof(j.result) <> 'object' then '{}'::jsonb
        else j.result
      end
    ) || jsonb_build_object(
      'archivedAsStaleFailure', true,
      'archivedAt', now(),
      'archivedReason', 'superseded_failed_incremental_sync',
      'archivedPreviousStatus', 'FAILED',
      'latestSuccessfulIncrementalSyncAt', (select completed_at from latest_success)
    ),
    "updatedAt" = now()
  where j.id in (select id from candidates)
  returning j."errorCode", j."updatedAt"
)
select jsonb_build_object(
  'mode', 'apply',
  'shopDomain', ${sqlString(shopDomain)},
  'latestSuccessfulIncrementalSyncAt', (select completed_at from latest_success),
  'maxAgeHours', ${Number(maxAgeHours)},
  'archivedCount', (select count(*)::int from updated),
  'byErrorCode', coalesce((
    select jsonb_agg(to_jsonb(grouped) order by grouped."lastUpdatedAt" desc)
    from (
      select
        coalesce("errorCode", 'NO_CODE') as "errorCode",
        count(*)::int as "jobCount",
        min("updatedAt") as "firstUpdatedAt",
        max("updatedAt") as "lastUpdatedAt"
      from updated
      group by coalesce("errorCode", 'NO_CODE')
    ) grouped
  ), '[]'::jsonb)
) as result;
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

function printSummary(result) {
  const count = result.archivedCount ?? result.archivableCount ?? 0;
  const verb = result.mode === "apply" ? "archiviati" : "archiviabili";

  console.log(`Shop: ${result.shopDomain ?? shopDomain}`);
  console.log(`Modalità: ${result.mode ?? "dry-run"}`);
  console.log(
    `Ultimo sync incrementale riuscito: ${
      result.latestSuccessfulIncrementalSyncAt ?? "non disponibile"
    }`,
  );
  console.log(`Età minima: ${result.maxAgeHours ?? maxAgeHours} ore`);
  console.log(`Job ${verb}: ${count}`);

  for (const row of result.byErrorCode ?? []) {
    console.log(
      `- ${row.errorCode}: ${row.jobCount} job, aggiornati da ${row.firstUpdatedAt} a ${row.lastUpdatedAt}`,
    );
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

    if (arg === "--max-age-hours") {
      const hours = Number.parseInt(rawArgs[index + 1] ?? "", 10);
      parsed.maxAgeHours =
        Number.isInteger(hours) && hours > 0 ? hours : undefined;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(`Uso: npm run jobs:archive-stale-failures -- [--shop dominio.myshopify.com] [--max-age-hours 24] [--apply] [--json]

Archivia come CANCELLED i vecchi job SYNC_INCREMENTAL FAILED superati da un sync incrementale riuscito più recente.
Senza --apply esegue solo una preview. Non stampa payload prodotto, token o dati personali.`);
      process.exit(0);
    }

    throw new Error(`Argomento non supportato: ${arg}`);
  }

  return parsed;
}

function findJsonStart(value) {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");

  if (objectStart < 0) return arrayStart;
  if (arrayStart < 0) return objectStart;

  return Math.min(objectStart, arrayStart);
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
    .replaceAll(/\nwith shop[\s\S]*/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildImportRunScopeSql } from "./syncbay-import-run-scope.mjs";
import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";

const execFileAsync = promisify(execFile);

const DEFAULT_RECENT_LIMIT = 12;

const args = parseArgs(process.argv.slice(2));
const shopDomain = resolveRequiredShopDomainOption({
  args,
  env: process.env,
});
const recentLimit = args.limit ?? DEFAULT_RECENT_LIMIT;
const importRunScopeSql = buildImportRunScopeSql("j");

const diagnosticsSql = `
with latest_run as (
  select ${importRunScopeSql} as run_id
  from "SyncJob" j
  join "Shop" s on s.id = j."shopId"
  where s."shopDomain" = ${sqlString(shopDomain)}
    and j.type = 'IMPORT_CATALOG'
    and j.payload ? 'catalogImportRunId'
  order by j."createdAt" desc
  limit 1
),
run_jobs as (
  select
    j.*,
    case
      when j.payload ? 'batchIndex' then 'catalog_batch'
      else 'shopify_import'
    end as job_kind,
    nullif(j.payload->>'batchIndex', '')::int as batch_index,
    nullif(j.payload->>'batchCount', '')::int as batch_count,
    jsonb_array_length(coalesce(j.payload->'ebayItemIds', '[]'::jsonb)) as item_count
  from "SyncJob" j
  join latest_run lr on lr.run_id = ${importRunScopeSql}
),
status_rows as (
  select
    job_kind,
    status,
    count(*)::int as job_count,
    coalesce(sum(item_count), 0)::int as item_count,
    min(batch_index) as first_batch,
    max(batch_index) as last_batch,
    max(batch_count) as batch_count,
    max("updatedAt") as last_updated_at
  from run_jobs
  group by job_kind, status
),
recent_rows as (
  select jsonb_agg(to_jsonb(recent) order by recent."updatedAt" desc) as rows
  from (
    select
      job_kind as "jobKind",
      status,
      attempts,
      batch_index as "batchIndex",
      batch_count as "batchCount",
      item_count as "itemCount",
      "createdAt",
      "updatedAt",
      "startedAt",
      "finishedAt",
      "errorCode",
      left(coalesce("errorMessage", ''), 260) as "errorMessage",
      result->>'createdCount' as "createdCount",
      result->>'reusedCount' as "reusedCount",
      result->>'failedCount' as "failedCount",
      result->>'skippedCount' as "skippedCount"
    from run_jobs
    order by "updatedAt" desc
    limit ${recentLimit}
  ) recent
)
select jsonb_build_object(
  'shopDomain', ${sqlString(shopDomain)},
  'runId', (select run_id from latest_run),
  'statusRows', coalesce((select jsonb_agg(to_jsonb(status_rows) order by job_kind, status) from status_rows), '[]'::jsonb),
  'queueRows', coalesce((
    select jsonb_agg(to_jsonb(queue_rows) order by type, status)
    from (
      select
        j.type,
        j.status,
        count(*)::int as job_count,
        min(j."runAfter") as first_run_after,
        max(j."updatedAt") as last_updated_at
      from "SyncJob" j
      join "Shop" s on s.id = j."shopId"
      where s."shopDomain" = ${sqlString(shopDomain)}
      group by j.type, j.status
    ) queue_rows
  ), '[]'::jsonb),
  'recentRows', coalesce((select rows from recent_rows), '[]'::jsonb)
) as diagnostics;
`;

await main().catch((error) => {
  console.error(`Diagnostica job non riuscita: ${formatCliError(error)}`);
  process.exit(1);
});

async function main() {
  const diagnostics = await querySupabaseJson(diagnosticsSql);
  const payload = diagnostics.rows?.[0]?.diagnostics;

  if (!payload?.runId) {
    console.log(`Nessun import catalogo trovato per ${shopDomain}.`);
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  printSummary(payload);
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
    .replaceAll(/\nwith latest_run[\s\S]*/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function printSummary(payload) {
  const activeStatuses = new Set(["PENDING", "RUNNING", "RETRYING"]);
  const rows = payload.statusRows ?? [];
  const activeCount = rows
    .filter((row) => activeStatuses.has(row.status))
    .reduce((total, row) => total + Number(row.job_count ?? 0), 0);
  const failedCount = rows
    .filter((row) => row.status === "FAILED")
    .reduce((total, row) => total + Number(row.job_count ?? 0), 0);

  console.log(`Shop: ${payload.shopDomain}`);
  console.log(`Run: ${payload.runId}`);
  console.log(
    `Stato: ${activeCount === 0 ? "nessun job attivo" : `${activeCount} job attivi`}${failedCount > 0 ? `, ${failedCount} falliti` : ""}`,
  );
  console.log("");
  console.log("Conteggi:");

  for (const row of rows) {
    const batchRange =
      row.first_batch && row.last_batch
        ? `, batch ${row.first_batch}-${row.last_batch}/${row.batch_count}`
        : "";
    console.log(
      `- ${row.job_kind} ${row.status}: ${row.job_count} job, ${row.item_count} item${batchRange}`,
    );
  }

  console.log("");
  console.log("Coda complessiva:");

  for (const row of payload.queueRows ?? []) {
    console.log(
      `- ${row.type} ${row.status}: ${row.job_count} job, primo runAfter ${row.first_run_after}, ultimo aggiornamento ${row.last_updated_at}`,
    );
  }

  console.log("");
  console.log("Recenti:");

  for (const row of payload.recentRows ?? []) {
    const batch = row.batchIndex
      ? ` batch ${row.batchIndex}/${row.batchCount}`
      : "";
    const error = row.errorCode
      ? `, ${row.errorCode}: ${row.errorMessage}`
      : "";
    const result =
      row.createdCount || row.reusedCount || row.failedCount || row.skippedCount
        ? `, creati ${row.createdCount ?? 0}, riusati ${row.reusedCount ?? 0}, falliti ${row.failedCount ?? 0}, saltati ${row.skippedCount ?? 0}`
        : "";

    console.log(
      `- ${row.jobKind}${batch}: ${row.status}, item ${row.itemCount}, tentativi ${row.attempts}, aggiornato ${row.updatedAt}${result}${error}`,
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
      console.log(`Uso: npm run jobs:status -- [--shop dominio.myshopify.com] [--limit 12] [--json]

Interroga il database Supabase remoto tramite \`supabase db query --linked\`.
Non richiede DATABASE_URL locale; usa SUPABASE_DB_PASSWORD o il Portachiavi macOS e non stampa segreti.`);
      process.exit(0);
    }

    throw new Error(`Argomento non supportato: ${arg}`);
  }

  return parsed;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

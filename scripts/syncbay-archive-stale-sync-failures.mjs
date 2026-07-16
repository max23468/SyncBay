#!/usr/bin/env node

import { parseArgs } from "node:util";
import {
  formatCliError,
  querySupabaseJson,
  sqlString,
} from "./supabase-cli-env.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";

const DEFAULT_MAX_AGE_HOURS = 24;
const ARCHIVABLE_ERROR_CODES = [
  "SYNCBAY_INCREMENTAL_BLOCKED",
  "SYNCBAY_INCREMENTAL_ENQUEUE_FAILED",
];

const { values: args } = parseArgs({
  options: {
    apply: { type: "boolean" },
    help: { short: "h", type: "boolean" },
    json: { type: "boolean" },
    "max-age-hours": { type: "string" },
    shop: { type: "string" },
  },
});

if (args.help) {
  console.log(`Uso: npm run jobs:archive-stale-failures -- [--shop dominio.myshopify.com] [--max-age-hours 24] [--apply] [--json]

Archivia come CANCELLED i vecchi job SYNC_INCREMENTAL FAILED superati da un sync incrementale riuscito più recente.
Senza --apply esegue solo una preview. Non stampa payload prodotto, token o dati personali.`);
  process.exit(0);
}

const shopDomain = resolveRequiredShopDomainOption({
  args,
  env: process.env,
});
const parsedMaxAgeHours = Number.parseInt(args["max-age-hours"] ?? "", 10);
const maxAgeHours =
  Number.isInteger(parsedMaxAgeHours) && parsedMaxAgeHours > 0
    ? parsedMaxAgeHours
    : DEFAULT_MAX_AGE_HOURS;

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

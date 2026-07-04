#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";

const execFileAsync = promisify(execFile);

const args = parseArgs(process.argv.slice(2));
const shopDomain = resolveRequiredShopDomainOption({
  args,
  env: process.env,
});

await main().catch((error) => {
  console.error(`Coalescenza webhook Shopify non riuscita: ${formatCliError(error)}`);
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

function buildBaseCteSql() {
  return `
with shop as (
  select id, "shopDomain"
  from "Shop"
  where "shopDomain" = ${sqlString(shopDomain)}
),
ranked as (
  select
    j.id,
    j."createdAt",
    j.payload->>'topic' as topic,
    coalesce(
      j.payload->>'resourceId',
      j.payload->>'inventoryItemGid',
      j.payload->>'adminGraphqlApiId',
      j.payload->>'admin_graphql_api_id'
    ) as resource_key,
    row_number() over (
      partition by j."shopId",
        j.payload->>'topic',
        coalesce(
          j.payload->>'resourceId',
          j.payload->>'inventoryItemGid',
          j.payload->>'adminGraphqlApiId',
          j.payload->>'admin_graphql_api_id'
        )
      order by j."createdAt" desc, j.id desc
    ) as resource_rank
  from "SyncJob" j
  where j."shopId" = (select id from shop)
    and j.type = 'DETECT_SHOPIFY_CHANGES'
    and j.status = 'PENDING'
    and j.payload->>'topic' is not null
    and coalesce(
      j.payload->>'resourceId',
      j.payload->>'inventoryItemGid',
      j.payload->>'adminGraphqlApiId',
      j.payload->>'admin_graphql_api_id'
    ) is not null
),
candidates as (
  select *
  from ranked
  where resource_rank > 1
)
`;
}

function buildPreviewSql() {
  return `
${buildBaseCteSql()}
select jsonb_build_object(
  'mode', 'dry-run',
  'shopDomain', ${sqlString(shopDomain)},
  'cancelableDuplicateCount', (select count(*)::int from candidates),
  'groups', coalesce((
    select jsonb_agg(to_jsonb(grouped) order by grouped."jobCount" desc, grouped."lastCreatedAt" desc)
    from (
      select
        topic,
        resource_key as "resourceKey",
        count(*)::int as "jobCount",
        min("createdAt") as "firstCreatedAt",
        max("createdAt") as "lastCreatedAt"
      from candidates
      group by topic, resource_key
      limit 20
    ) grouped
  ), '[]'::jsonb)
) as result;
`;
}

function buildApplySql() {
  return `
${buildBaseCteSql()},
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
      'coalescedDuplicateShopifyChange', true,
      'coalescedAt', now(),
      'coalescedReason', 'newer_pending_shopify_change_job_exists',
      'coalescedPreviousStatus', 'PENDING'
    ),
    "updatedAt" = now()
  where j.id in (select id from candidates)
  returning j.payload->>'topic' as topic,
    coalesce(
      j.payload->>'resourceId',
      j.payload->>'inventoryItemGid',
      j.payload->>'adminGraphqlApiId',
      j.payload->>'admin_graphql_api_id'
    ) as resource_key,
    j."updatedAt"
)
select jsonb_build_object(
  'mode', 'apply',
  'shopDomain', ${sqlString(shopDomain)},
  'cancelledDuplicateCount', (select count(*)::int from updated),
  'groups', coalesce((
    select jsonb_agg(to_jsonb(grouped) order by grouped."jobCount" desc, grouped."lastUpdatedAt" desc)
    from (
      select
        topic,
        resource_key as "resourceKey",
        count(*)::int as "jobCount",
        min("updatedAt") as "firstUpdatedAt",
        max("updatedAt") as "lastUpdatedAt"
      from updated
      group by topic, resource_key
      limit 20
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
      cwd: process.env.SYNCBAY_SUPABASE_CWD ?? process.cwd(),
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
  const count =
    result.cancelledDuplicateCount ?? result.cancelableDuplicateCount ?? 0;
  const verb = result.mode === "apply" ? "cancellati" : "cancellabili";

  console.log(`Shop: ${result.shopDomain ?? shopDomain}`);
  console.log(`Modalità: ${result.mode ?? "dry-run"}`);
  console.log(`Job webhook duplicati ${verb}: ${count}`);

  for (const row of result.groups ?? []) {
    console.log(
      `- ${row.topic} ${row.resourceKey}: ${row.jobCount} job`,
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

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
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

  return useful.split("\n").filter(Boolean).slice(0, 3).join(" ");
}

function sanitizeErrorText(value) {
  return String(value)
    .replaceAll(/\s+/g, " ")
    .trim();
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function printHelp() {
  console.log(`Uso: npm run jobs:coalesce-shopify-changes -- [opzioni]

Coalescenza dei job DETECT_SHOPIFY_CHANGES duplicati.
Mantiene il job PENDING piu recente per shop/topic/risorsa Shopify
resourceId, inventoryItemGid o admin_graphql_api_id e marca come CANCELLED i
duplicati piu vecchi solo con --apply.

Opzioni:
  --shop <dominio>  Shop target. Obbligatorio se SHOPIFY_DEV_STORE non e configurato.
  --apply           Applica la cancellazione logica dei duplicati.
  --json            Stampa il risultato JSON.
  --help            Mostra questa guida.
`);
}

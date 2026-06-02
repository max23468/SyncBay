#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";

const execFileAsync = promisify(execFile);

const DEFAULT_SHOP_DOMAIN = "syncbay-dev.myshopify.com";

const args = parseArgs(process.argv.slice(2));
const shopDomain =
  args.shop ?? process.env.SHOPIFY_DEV_STORE ?? DEFAULT_SHOP_DOMAIN;

await main().catch((error) => {
  console.error(`Repair conflitti descrizione non riuscito: ${formatCliError(error)}`);
  process.exit(1);
});

async function main() {
  const payload = args.apply
    ? await querySupabaseJson(buildApplySql())
    : await querySupabaseJson(buildDryRunSql());
  const result = payload.rows?.[0]?.result;

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printSummary(result, args.apply);
}

function buildDryRunSql() {
  return `
with latest_syncbay as (
  select distinct on (ps."mappingId")
    ps."mappingId",
    ps."descriptionHash"
  from "ProductSnapshot" ps
  join "Shop" s on s.id = ps."shopId"
  where s."shopDomain" = ${sqlString(shopDomain)}
    and ps.source = 'SYNCBAY'
    and ps."mappingId" is not null
  order by ps."mappingId", ps."capturedAt" desc
),
target_conflicts as (
  select sc.id
  from "SyncConflict" sc
  join "Shop" s on s.id = sc."shopId"
  join latest_syncbay ls on ls."mappingId" = sc."mappingId"
  where s."shopDomain" = ${sqlString(shopDomain)}
    and sc.status = 'OPEN'
    and sc.field = 'description'
    and sc."shopifyValue" #>> '{}' is not null
    and ls."descriptionHash" = sc."lastSyncBayValue" #>> '{}'
)
select jsonb_build_object(
  'mode', 'dry-run',
  'shopDomain', ${sqlString(shopDomain)},
  'openDescriptionConflictCount', (
    select count(*)::int
    from "SyncConflict" sc
    join "Shop" s on s.id = sc."shopId"
    where s."shopDomain" = ${sqlString(shopDomain)}
      and sc.status = 'OPEN'
      and sc.field = 'description'
  ),
  'repairableConflictCount', (select count(*)::int from target_conflicts)
) as result;
`;
}

function buildApplySql() {
  return `
with latest_syncbay as (
  select distinct on (ps."mappingId")
    ps.*
  from "ProductSnapshot" ps
  join "Shop" s on s.id = ps."shopId"
  where s."shopDomain" = ${sqlString(shopDomain)}
    and ps.source = 'SYNCBAY'
    and ps."mappingId" is not null
  order by ps."mappingId", ps."capturedAt" desc
),
target_conflicts as (
  select
    sc.id,
    sc."shopId",
    sc."mappingId",
    sc."shopifyValue" #>> '{}' as shopify_hash
  from "SyncConflict" sc
  join "Shop" s on s.id = sc."shopId"
  join latest_syncbay ls on ls."mappingId" = sc."mappingId"
  where s."shopDomain" = ${sqlString(shopDomain)}
    and sc.status = 'OPEN'
    and sc.field = 'description'
    and sc."shopifyValue" #>> '{}' is not null
    and ls."descriptionHash" = sc."lastSyncBayValue" #>> '{}'
),
inserted_snapshots as (
  insert into "ProductSnapshot" (
    id,
    "shopId",
    "mappingId",
    source,
    "ebayItemId",
    "shopifyProductGid",
    "shopifyVariantGid",
    sku,
    title,
    "priceAmount",
    currency,
    quantity,
    "productStatus",
    "descriptionHash",
    "imageCount",
    payload,
    "capturedAt"
  )
  select
    gen_random_uuid()::text,
    ls."shopId",
    ls."mappingId",
    ls.source,
    ls."ebayItemId",
    ls."shopifyProductGid",
    ls."shopifyVariantGid",
    ls.sku,
    ls.title,
    ls."priceAmount",
    ls.currency,
    ls.quantity,
    ls."productStatus",
    tc.shopify_hash,
    ls."imageCount",
    coalesce(ls.payload, '{}'::jsonb) || jsonb_build_object(
      'descriptionBaselineRepair',
      jsonb_build_object(
        'conflictId', tc.id,
        'repairedAt', now()
      )
    ),
    now()
  from target_conflicts tc
  join latest_syncbay ls on ls."mappingId" = tc."mappingId"
  returning id
),
updated_conflicts as (
  update "SyncConflict" sc
  set
    status = 'RESOLVED',
    resolution = 'KEEP_SHOPIFY',
    "resolvedAt" = now(),
    "updatedAt" = now()
  where sc.id in (select id from target_conflicts)
  returning sc.id, sc."shopId"
),
audit as (
  insert into "AuditLog" (id, "shopId", type, message, details, "createdAt")
  select
    gen_random_uuid()::text,
    (select s.id from "Shop" s where s."shopDomain" = ${sqlString(shopDomain)} limit 1),
    'CONNECTION_CHECK',
    'Falsi conflitti descrizione riparati con baseline Shopify.',
    jsonb_build_object(
      'repair', 'description_conflict_baseline',
      'resolvedConflictCount', (select count(*)::int from updated_conflicts),
      'insertedSnapshotCount', (select count(*)::int from inserted_snapshots)
    ),
    now()
  where (select count(*) from updated_conflicts) > 0
  returning id
)
select jsonb_build_object(
  'mode', 'apply',
  'shopDomain', ${sqlString(shopDomain)},
  'resolvedConflictCount', (select count(*)::int from updated_conflicts),
  'insertedSnapshotCount', (select count(*)::int from inserted_snapshots),
  'auditLogCount', (select count(*)::int from audit)
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
      timeout: 60_000,
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

function printSummary(result, applied) {
  if (!result) {
    console.log("Nessun risultato restituito.");
    return;
  }

  console.log(`Shop: ${result.shopDomain}`);

  if (applied) {
    console.log(`Conflitti risolti: ${result.resolvedConflictCount}`);
    console.log(`Snapshot baseline creati: ${result.insertedSnapshotCount}`);
    console.log(`Audit log creati: ${result.auditLogCount}`);
    return;
  }

  console.log("Modalità: dry-run");
  console.log(
    `Conflitti descrizione aperti: ${result.openDescriptionConflictCount}`,
  );
  console.log(`Conflitti riparabili: ${result.repairableConflictCount}`);
  console.log("");
  console.log("Per applicare: npm run conflicts:repair-description -- --apply");
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
    .replaceAll(/\nwith latest_syncbay[\s\S]*/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
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
      console.log(`Uso: npm run conflicts:repair-description -- [--shop dominio.myshopify.com] [--apply] [--json]

Dry-run predefinito. Con --apply risolve i falsi conflitti aperti sul campo
description creando una nuova baseline SyncBay con l'hash Shopify già rilevato.
Non stampa dati prodotto o valori descrizione.`);
      process.exit(0);
    }

    throw new Error(`Argomento non supportato: ${arg}`);
  }

  return parsed;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

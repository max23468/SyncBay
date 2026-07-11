#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  getSupabaseCliCwd,
  getSupabaseCliEnv,
} from "./supabase-cli-env.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";

const execFileAsync = promisify(execFile);

const args = parseArgs(process.argv.slice(2));
const shopDomain = resolveRequiredShopDomainOption({
  args,
  env: process.env,
});

await main().catch((error) => {
  console.error(`Repair conflitti immagini non riuscito: ${formatCliError(error)}`);
  process.exit(1);
});

async function main() {
  const candidates = await loadRepairableImageConflicts();
  const result = args.apply
    ? await applyRepairs(candidates)
    : buildDryRunResult(candidates);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printSummary(result, args.apply);
}

async function loadRepairableImageConflicts() {
  const payload = await querySupabaseJson(buildCandidateSql());

  return payload.rows?.[0]?.rows ?? [];
}

// Un conflitto `images` è un falso positivo da baseline stale quando: il mapping
// è ACTIVE, il valore Shopify registrato nel conflitto è un conteggio valido, e
// una precedente baseline SyncBay aveva già registrato esattamente quel
// conteggio (prova che SyncBay stesso ha stabilito quelle immagini e che il
// prodotto le ha ancora). La baseline corrente registrata nel conflitto è
// invece diversa (tipicamente 0), effetto del bug di conteggio media. La
// riparazione riallinea la baseline al conteggio Shopify reale; non scrive su
// Shopify o eBay.
function buildCandidateSql() {
  return `
with shop_row as (
  select id, "shopDomain"
  from "Shop"
  where "shopDomain" = ${sqlString(shopDomain)}
  limit 1
),
latest_syncbay as (
  select distinct on (ps."mappingId")
    ps.*
  from "ProductSnapshot" ps
  join shop_row s on s.id = ps."shopId"
  where ps.source = 'SYNCBAY'
    and ps."mappingId" is not null
  order by ps."mappingId", ps."capturedAt" desc
),
current_field_baselines as (
  select
    ls.*,
    title_snapshot.title as "currentTitle",
    price_snapshot.currency as "currentCurrency",
    price_snapshot."priceAmount" as "currentPriceAmount",
    quantity_snapshot.quantity as "currentQuantity",
    status_snapshot."productStatus" as "currentProductStatus",
    description_snapshot."descriptionHash" as "currentDescriptionHash"
  from latest_syncbay ls
  left join lateral (
    select ps.title
    from "ProductSnapshot" ps
    where ps."mappingId" = ls."mappingId"
      and ps.source = 'SYNCBAY'
      and ps.title is not null
    order by ps."capturedAt" desc
    limit 1
  ) title_snapshot on true
  left join lateral (
    select ps.currency, ps."priceAmount"
    from "ProductSnapshot" ps
    where ps."mappingId" = ls."mappingId"
      and ps.source = 'SYNCBAY'
      and ps."priceAmount" is not null
    order by ps."capturedAt" desc
    limit 1
  ) price_snapshot on true
  left join lateral (
    select ps.quantity
    from "ProductSnapshot" ps
    where ps."mappingId" = ls."mappingId"
      and ps.source = 'SYNCBAY'
      and ps.quantity is not null
    order by ps."capturedAt" desc
    limit 1
  ) quantity_snapshot on true
  left join lateral (
    select ps."productStatus"
    from "ProductSnapshot" ps
    where ps."mappingId" = ls."mappingId"
      and ps.source = 'SYNCBAY'
      and ps."productStatus" is not null
    order by ps."capturedAt" desc
    limit 1
  ) status_snapshot on true
  left join lateral (
    select ps."descriptionHash"
    from "ProductSnapshot" ps
    where ps."mappingId" = ls."mappingId"
      and ps.source = 'SYNCBAY'
      and ps."descriptionHash" is not null
    order by ps."capturedAt" desc
    limit 1
  ) description_snapshot on true
)
select coalesce(jsonb_agg(to_jsonb(rows) order by rows."detectedAt"), '[]'::jsonb) as rows
from (
  select
    sc.id as "conflictId",
    sc."lastSyncBayValue",
    sc."shopifyValue",
    sc."detectedAt",
    (sc."shopifyValue" #>> '{}')::int as "correctedImageCount",
    s.id as "shopId",
    pm.id as "mappingId",
    pm."ebayItemId",
    pm."shopifyProductGid",
    pm."shopifyVariantGid",
    pm.sku as "mappingSku",
    cb."currentTitle",
    cb."currentCurrency",
    cb."currentPriceAmount",
    cb."currentQuantity",
    cb."currentProductStatus",
    cb."currentDescriptionHash",
    cb.payload
  from "SyncConflict" sc
  join shop_row s on s.id = sc."shopId"
  join "ProductMapping" pm on pm.id = sc."mappingId"
  join current_field_baselines cb on cb."mappingId" = pm.id
  where sc.status = 'OPEN'
    and sc.field = 'images'
    and pm.status = 'ACTIVE'
    and sc."shopifyValue" #>> '{}' ~ '^[0-9]+$'
    and (sc."lastSyncBayValue" #>> '{}') is distinct from (sc."shopifyValue" #>> '{}')
    and exists (
      select 1
      from "ProductSnapshot" ps
      where ps."mappingId" = sc."mappingId"
        and ps.source = 'SYNCBAY'
        and ps."imageCount" = (sc."shopifyValue" #>> '{}')::int
    )
) rows;
`;
}

function buildDryRunResult(candidates) {
  return {
    checkedAt: new Date().toISOString(),
    mode: "dry-run",
    repairableImageConflictCount: candidates.length,
    shopDomain,
    sample: candidates.slice(0, 10).map((row) => ({
      baseline: row.lastSyncBayValue,
      correctedImageCount: row.correctedImageCount,
      shopifyValue: row.shopifyValue,
    })),
  };
}

async function applyRepairs(candidates) {
  if (candidates.length === 0) {
    return {
      checkedAt: new Date().toISOString(),
      insertedSnapshotCount: 0,
      mode: "apply",
      repairableImageConflictCount: 0,
      resolvedConflictCount: 0,
      shopDomain,
    };
  }

  const payload = await querySupabaseJson(buildApplySql(candidates));

  return payload.rows?.[0]?.result;
}

function buildApplySql(candidates) {
  const repairsJson = sqlString(JSON.stringify(candidates));

  return `
with repair_rows as (
  select *
  from jsonb_to_recordset(${repairsJson}::jsonb) as r(
    "conflictId" text,
    "shopId" text,
    "mappingId" text,
    "ebayItemId" text,
    "shopifyProductGid" text,
    "shopifyVariantGid" text,
    "mappingSku" text,
    "currentTitle" text,
    "currentCurrency" text,
    "currentPriceAmount" numeric,
    "currentQuantity" int,
    "currentProductStatus" text,
    "currentDescriptionHash" text,
    "correctedImageCount" int,
    payload jsonb
  )
),
updated_conflicts as (
  update "SyncConflict" sc
  set
    status = 'RESOLVED',
    resolution = 'KEEP_SHOPIFY',
    "resolvedAt" = now(),
    "updatedAt" = now()
  where sc.id in (select "conflictId" from repair_rows)
    and sc.status = 'OPEN'
    and sc.field = 'images'
  returning sc.id, sc."mappingId"
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
    r."shopId",
    r."mappingId",
    'SYNCBAY',
    r."ebayItemId",
    r."shopifyProductGid",
    r."shopifyVariantGid",
    r."mappingSku",
    r."currentTitle",
    r."currentPriceAmount",
    r."currentCurrency",
    r."currentQuantity",
    r."currentProductStatus",
    r."currentDescriptionHash",
    r."correctedImageCount",
    (coalesce(r.payload, '{}'::jsonb) - 'updatedEbayFromShopifyOrder' - 'restoredEbayAfterTest') ||
      jsonb_build_object(
        'conflictResolution',
        jsonb_build_object(
          'conflictId', r."conflictId",
          'field', 'images',
          'resolution', 'KEEP_SHOPIFY',
          'source', 'targeted_image_conflict_repair'
        ),
        'imageConflictBaselineRepair',
        jsonb_build_object(
          'conflictId', r."conflictId",
          'correctedImageCount', r."correctedImageCount",
          'repairedAt', now()
        )
      ),
    now()
  from repair_rows r
  join updated_conflicts uc
    on uc.id = r."conflictId"
  returning id
),
updated_mappings as (
  update "ProductMapping" pm
  set "lastSyncedAt" = now()
  where pm.id in (select "mappingId" from updated_conflicts)
  returning pm.id
),
audit as (
  insert into "AuditLog" (id, "shopId", type, message, details, "createdAt")
  select
    gen_random_uuid()::text,
    (select s.id from "Shop" s where s."shopDomain" = ${sqlString(shopDomain)} limit 1),
    'CONNECTION_CHECK',
    'Falsi conflitti immagini riparati con baseline Shopify.',
    jsonb_build_object(
      'repair', 'image_conflict_stale_baseline',
      'resolvedConflictCount', (select count(*)::int from updated_conflicts),
      'insertedSnapshotCount', (select count(*)::int from inserted_snapshots)
    ),
    now()
  where (select count(*) from updated_conflicts) > 0
  returning id
)
select jsonb_build_object(
  'checkedAt', now(),
  'mode', 'apply',
  'shopDomain', ${sqlString(shopDomain)},
  'repairableImageConflictCount', (select count(*)::int from repair_rows),
  'resolvedConflictCount', (select count(*)::int from updated_conflicts),
  'insertedSnapshotCount', (select count(*)::int from inserted_snapshots),
  'updatedMappingCount', (select count(*)::int from updated_mappings),
  'auditLogInserted', (select count(*)::int from audit) > 0
) as result;
`;
}

async function querySupabaseJson(sql) {
  const { stdout } = await execFileAsync(
    "npx",
    ["supabase", "db", "query", "--linked", "--output", "json", sql],
    {
      cwd: getSupabaseCliCwd(),
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

function printSummary(result, apply) {
  console.log(`Shop: ${result.shopDomain}`);
  console.log(`Modo: ${result.mode}`);

  if (apply) {
    console.log(`Conflitti immagini risolti: ${result.resolvedConflictCount}`);
    console.log(`Baseline create: ${result.insertedSnapshotCount}`);
    return;
  }

  console.log(`Conflitti immagini riparabili: ${result.repairableImageConflictCount}`);

  if (result.repairableImageConflictCount > 0) {
    console.log("Prossimo passo: npm run conflicts:repair-images -- --apply");
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
      console.log(`Uso: npm run conflicts:repair-images -- [--shop dominio.myshopify.com] [--apply] [--json]

Ripara falsi conflitti immagini aperti quando la baseline SyncBay registrata è
derivata dal conteggio media di una run che non ha toccato le immagini, mentre
una baseline precedente aveva già registrato il conteggio reale confermato dal
valore Shopify del conflitto. Non scrive su Shopify o eBay; crea una baseline
SyncBay allineata e chiude il conflitto.`);
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
  if (value == null) return "null";

  return `'${String(value).replaceAll("'", "''")}'`;
}

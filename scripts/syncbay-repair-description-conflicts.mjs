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
    and ps."descriptionHash" is not null
    and not (
      coalesce(ps.payload->>'updatedEbayFromShopifyOrder', 'false') = 'true'
      and not coalesce(ps.payload ? 'conflictResolution', false)
    )
    and not (
      coalesce(ps.payload->>'restoredEbayAfterTest', 'false') = 'true'
      and not coalesce(ps.payload ? 'conflictResolution', false)
    )
  order by ps."mappingId", ps."capturedAt" desc
),
baseline_repairable_conflicts as (
  select sc.id
  from "SyncConflict" sc
  join "Shop" s on s.id = sc."shopId"
  join latest_syncbay ls on ls."mappingId" = sc."mappingId"
  where s."shopDomain" = ${sqlString(shopDomain)}
    and sc.status = 'OPEN'
    and sc.field = 'description'
    and sc."shopifyValue" #>> '{}' is not null
    and ls."descriptionHash" = sc."lastSyncBayValue" #>> '{}'
    and ls."descriptionHash" is distinct from sc."shopifyValue" #>> '{}'
),
aligned_conflicts as (
  select sc.id
  from "SyncConflict" sc
  join "Shop" s on s.id = sc."shopId"
  join latest_syncbay ls on ls."mappingId" = sc."mappingId"
  where s."shopDomain" = ${sqlString(shopDomain)}
    and sc.status = 'OPEN'
    and sc.field = 'description'
    and sc."shopifyValue" #>> '{}' is not null
    and ls."descriptionHash" = sc."shopifyValue" #>> '{}'
),
inactive_mapping_conflicts as (
  select sc.id
  from "SyncConflict" sc
  join "Shop" s on s.id = sc."shopId"
  join "ProductMapping" pm on pm.id = sc."mappingId"
  where s."shopDomain" = ${sqlString(shopDomain)}
    and sc.status = 'OPEN'
    and pm.status in ('OUT_OF_STOCK', 'ARCHIVED')
),
repairable_conflicts as (
  select id from baseline_repairable_conflicts
  union
  select id from aligned_conflicts
  union
  select id from inactive_mapping_conflicts
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
  'baselineRepairableConflictCount', (select count(*)::int from baseline_repairable_conflicts),
  'alignedConflictCount', (select count(*)::int from aligned_conflicts),
  'inactiveMappingConflictCount', (select count(*)::int from inactive_mapping_conflicts),
  'repairableConflictCount', (select count(*)::int from repairable_conflicts)
) as result;
`;
}

function buildApplySql() {
  return `
with latest_description_syncbay as (
  select distinct on (ps."mappingId")
    ps.*
  from "ProductSnapshot" ps
  join "Shop" s on s.id = ps."shopId"
  where s."shopDomain" = ${sqlString(shopDomain)}
    and ps.source = 'SYNCBAY'
    and ps."mappingId" is not null
    and ps."descriptionHash" is not null
    and not (
      coalesce(ps.payload->>'updatedEbayFromShopifyOrder', 'false') = 'true'
      and not coalesce(ps.payload ? 'conflictResolution', false)
    )
    and not (
      coalesce(ps.payload->>'restoredEbayAfterTest', 'false') = 'true'
      and not coalesce(ps.payload ? 'conflictResolution', false)
    )
  order by ps."mappingId", ps."capturedAt" desc
),
latest_syncbay as (
  select distinct on (ps."mappingId")
    ps.*
  from "ProductSnapshot" ps
  join "Shop" s on s.id = ps."shopId"
  where s."shopDomain" = ${sqlString(shopDomain)}
    and ps.source = 'SYNCBAY'
    and ps."mappingId" is not null
  order by ps."mappingId", ps."capturedAt" desc
),
current_field_baselines as (
  select
    ls.*,
    title_snapshot.title as current_title,
    price_snapshot."priceAmount" as current_price_amount,
    price_snapshot.currency as current_currency,
    quantity_snapshot.quantity as current_quantity,
    status_snapshot."productStatus" as current_product_status,
    image_snapshot."imageCount" as current_image_count
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
    select ps."priceAmount", ps.currency
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
    select ps."imageCount"
    from "ProductSnapshot" ps
    where ps."mappingId" = ls."mappingId"
      and ps.source = 'SYNCBAY'
      and ps."imageCount" is not null
    order by ps."capturedAt" desc
    limit 1
  ) image_snapshot on true
),
baseline_repairable_conflicts as (
  select
    sc.id,
    sc."shopId",
    sc."mappingId",
    sc."shopifyValue" #>> '{}' as shopify_hash
  from "SyncConflict" sc
  join "Shop" s on s.id = sc."shopId"
  join latest_description_syncbay ls on ls."mappingId" = sc."mappingId"
  where s."shopDomain" = ${sqlString(shopDomain)}
    and sc.status = 'OPEN'
    and sc.field = 'description'
    and sc."shopifyValue" #>> '{}' is not null
    and ls."descriptionHash" = sc."lastSyncBayValue" #>> '{}'
    and ls."descriptionHash" is distinct from sc."shopifyValue" #>> '{}'
),
aligned_conflicts as (
  select sc.id, sc."shopId"
  from "SyncConflict" sc
  join "Shop" s on s.id = sc."shopId"
  join latest_description_syncbay ls on ls."mappingId" = sc."mappingId"
  where s."shopDomain" = ${sqlString(shopDomain)}
    and sc.status = 'OPEN'
    and sc.field = 'description'
    and sc."shopifyValue" #>> '{}' is not null
    and ls."descriptionHash" = sc."shopifyValue" #>> '{}'
),
inactive_mapping_conflicts as (
  select sc.id, sc."shopId"
  from "SyncConflict" sc
  join "Shop" s on s.id = sc."shopId"
  join "ProductMapping" pm on pm.id = sc."mappingId"
  where s."shopDomain" = ${sqlString(shopDomain)}
    and sc.status = 'OPEN'
    and pm.status in ('OUT_OF_STOCK', 'ARCHIVED')
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
    cb."shopId",
    cb."mappingId",
    cb.source,
    cb."ebayItemId",
    cb."shopifyProductGid",
    cb."shopifyVariantGid",
    cb.sku,
    cb.current_title,
    cb.current_price_amount,
    cb.current_currency,
    cb.current_quantity,
    cb.current_product_status,
    tc.shopify_hash,
    cb.current_image_count,
    (coalesce(cb.payload, '{}'::jsonb) - 'updatedEbayFromShopifyOrder' - 'restoredEbayAfterTest') || jsonb_build_object(
      'descriptionBaselineRepair',
      jsonb_build_object(
        'conflictId', tc.id,
        'repairedAt', now()
      )
    ),
    now()
  from baseline_repairable_conflicts tc
  join current_field_baselines cb on cb."mappingId" = tc."mappingId"
    and cb."shopId" = tc."shopId"
  returning id
),
updated_baseline_conflicts as (
  update "SyncConflict" sc
  set
    status = 'RESOLVED',
    resolution = 'KEEP_SHOPIFY',
    "resolvedAt" = now(),
    "updatedAt" = now()
  where sc.id in (select id from baseline_repairable_conflicts)
  returning sc.id, sc."shopId"
),
updated_aligned_conflicts as (
  update "SyncConflict" sc
  set
    status = 'RESOLVED',
    "resolvedAt" = now(),
    "updatedAt" = now()
  where sc.id in (select id from aligned_conflicts)
    and sc.id not in (select id from baseline_repairable_conflicts)
  returning sc.id, sc."shopId"
),
updated_inactive_mapping_conflicts as (
  update "SyncConflict" sc
  set
    status = 'RESOLVED',
    "resolvedAt" = now(),
    "updatedAt" = now()
  where sc.id in (select id from inactive_mapping_conflicts)
    and sc.id not in (select id from baseline_repairable_conflicts)
    and sc.id not in (select id from aligned_conflicts)
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
      'baselineResolvedConflictCount', (select count(*)::int from updated_baseline_conflicts),
      'alignedResolvedConflictCount', (select count(*)::int from updated_aligned_conflicts),
      'inactiveMappingResolvedConflictCount', (select count(*)::int from updated_inactive_mapping_conflicts),
      'resolvedConflictCount',
        (select count(*)::int from updated_baseline_conflicts) +
        (select count(*)::int from updated_aligned_conflicts) +
        (select count(*)::int from updated_inactive_mapping_conflicts),
      'insertedSnapshotCount', (select count(*)::int from inserted_snapshots)
    ),
    now()
  where
    (select count(*) from updated_baseline_conflicts) > 0 or
    (select count(*) from updated_aligned_conflicts) > 0 or
    (select count(*) from updated_inactive_mapping_conflicts) > 0
  returning id
)
select jsonb_build_object(
  'mode', 'apply',
  'shopDomain', ${sqlString(shopDomain)},
  'baselineResolvedConflictCount', (select count(*)::int from updated_baseline_conflicts),
  'alignedResolvedConflictCount', (select count(*)::int from updated_aligned_conflicts),
  'inactiveMappingResolvedConflictCount', (select count(*)::int from updated_inactive_mapping_conflicts),
  'resolvedConflictCount',
    (select count(*)::int from updated_baseline_conflicts) +
    (select count(*)::int from updated_aligned_conflicts) +
    (select count(*)::int from updated_inactive_mapping_conflicts),
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
    console.log(
      `Conflitti già allineati chiusi: ${result.alignedResolvedConflictCount}`,
    );
    console.log(
      `Conflitti con baseline riparata: ${result.baselineResolvedConflictCount}`,
    );
    console.log(
      `Conflitti su mapping inattivi chiusi: ${result.inactiveMappingResolvedConflictCount}`,
    );
    console.log(`Snapshot baseline creati: ${result.insertedSnapshotCount}`);
    console.log(`Audit log creati: ${result.auditLogCount}`);
    return;
  }

  console.log("Modalità: dry-run");
  console.log(
    `Conflitti descrizione aperti: ${result.openDescriptionConflictCount}`,
  );
  console.log(`Conflitti riparabili: ${result.repairableConflictCount}`);
  console.log(
    `Già allineati da chiudere: ${result.alignedConflictCount}`,
  );
  console.log(
    `Da riparare creando baseline: ${result.baselineRepairableConflictCount}`,
  );
  console.log(
    `Su mapping inattivi da chiudere: ${result.inactiveMappingConflictCount}`,
  );
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

Dry-run predefinito. Con --apply chiude i falsi conflitti description già
allineati alla baseline SyncBay più recente e crea una baseline solo quando
serve conservare l'hash Shopify rilevato.
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

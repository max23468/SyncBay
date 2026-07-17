#!/usr/bin/env node

import { parseArgs } from "node:util";
import {
  formatCliError,
  querySupabaseJson,
  sqlString,
} from "./supabase-cli-env.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";

const DEFAULT_STALE_HOURS = 24;
const ACTIVE_JOB_STATUSES = ["PENDING", "RUNNING", "RETRYING"];

const { values: args } = parseArgs({
  options: {
    help: { short: "h", type: "boolean" },
    json: { type: "boolean" },
    shop: { type: "string" },
    "stale-hours": { type: "string" },
  },
});

if (args.help) {
  console.log(`Uso: npm run conflicts:doctor -- [--shop dominio.myshopify.com] [--stale-hours 24] [--json]

Diagnostica in sola lettura per conflitti e retry stale. Non stampa valori
prodotto, descrizioni, token o dati cliente.`);
  process.exit(0);
}

const shopDomain = resolveRequiredShopDomainOption({
  args,
  env: process.env,
});
const parsedStaleHours = Number.parseInt(args["stale-hours"] ?? "", 10);
const staleHours =
  Number.isInteger(parsedStaleHours) && parsedStaleHours > 0
    ? parsedStaleHours
    : DEFAULT_STALE_HOURS;

await main().catch((error) => {
  console.error(`Doctor conflitti non riuscito: ${formatCliError(error)}`);
  process.exit(1);
});

async function main() {
  const diagnostics = await querySupabaseJson(buildDiagnosticsSql());
  const report = diagnostics.rows?.[0]?.diagnostics;

  if (!report) {
    throw new Error("Supabase non ha restituito diagnostics.");
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printReport(report);
}

function buildDiagnosticsSql() {
  const activeStatuses = ACTIVE_JOB_STATUSES.map(sqlString).join(", ");

  return `
with shop_row as (
  select id, "shopDomain"
  from "Shop"
  where "shopDomain" = ${sqlString(shopDomain)}
  limit 1
),
latest_syncbay as (
  select distinct on (ps."mappingId")
    ps."mappingId",
    ps."descriptionHash"
  from "ProductSnapshot" ps
  join shop_row s on s.id = ps."shopId"
  where ps.source = 'SYNCBAY'
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
baseline_repairable_description as (
  select sc.id
  from "SyncConflict" sc
  join shop_row s on s.id = sc."shopId"
  join latest_syncbay ls on ls."mappingId" = sc."mappingId"
  where sc.status = 'OPEN'
    and sc.field = 'description'
    and sc."shopifyValue" #>> '{}' is not null
    and ls."descriptionHash" = sc."lastSyncBayValue" #>> '{}'
    and ls."descriptionHash" is distinct from sc."shopifyValue" #>> '{}'
),
aligned_description as (
  select sc.id
  from "SyncConflict" sc
  join shop_row s on s.id = sc."shopId"
  join latest_syncbay ls on ls."mappingId" = sc."mappingId"
  where sc.status = 'OPEN'
    and sc.field = 'description'
    and sc."shopifyValue" #>> '{}' is not null
    and ls."descriptionHash" = sc."shopifyValue" #>> '{}'
),
inactive_mapping_conflicts as (
  select sc.id
  from "SyncConflict" sc
  join shop_row s on s.id = sc."shopId"
  join "ProductMapping" pm on pm.id = sc."mappingId"
  where sc.status = 'OPEN'
    and pm.status = 'OUT_OF_STOCK'
),
repairable_images as (
  -- Falsi conflitti immagini da baseline stale: baseline diversa dal valore
  -- Shopify ma una precedente baseline SyncBay aveva già registrato quel
  -- conteggio.
  select sc.id
  from "SyncConflict" sc
  join shop_row s on s.id = sc."shopId"
  join "ProductMapping" pm on pm.id = sc."mappingId"
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
),
repairable_conflicts as (
  select id from baseline_repairable_description
  union
  select id from aligned_description
  union
  select id from inactive_mapping_conflicts
  union
  select id from repairable_images
),
conflict_rows as (
  select jsonb_agg(to_jsonb(rows) order by rows.status, rows.field) as rows
  from (
    select
      sc.status,
      sc.field,
      count(*)::int as "conflictCount",
      count(*) filter (
        where sc.status = 'OPEN'
          and sc."detectedAt" < now() - (${staleHours}::text || ' hours')::interval
      )::int as "staleConflictCount",
      min(sc."detectedAt") as "oldestDetectedAt",
      max(sc."updatedAt") as "lastUpdatedAt"
    from "SyncConflict" sc
    join shop_row s on s.id = sc."shopId"
    group by sc.status, sc.field
  ) rows
),
queue_rows as (
  select jsonb_agg(to_jsonb(rows) order by rows.type, rows.status) as rows
  from (
    select
      j.type,
      j.status,
      count(*)::int as "jobCount",
      min(j."runAfter") as "firstRunAfter",
      max(j."updatedAt") as "lastUpdatedAt"
    from "SyncJob" j
    join shop_row s on s.id = j."shopId"
    where j.status in (${activeStatuses})
    group by j.type, j.status
  ) rows
),
cooldown_rows as (
  select jsonb_agg(to_jsonb(rows) order by rows."retryAt") as rows
  from (
    select
      j.type,
      j.status,
      j."errorCode",
      count(*)::int as "jobCount",
      min(j."runAfter") as "retryAt",
      max(j."updatedAt") as "lastUpdatedAt"
    from "SyncJob" j
    join shop_row s on s.id = j."shopId"
    where j."runAfter" > now()
      and (
        j."errorCode" = 'EBAY_TRADING_RATE_LIMITED'
        or (
          j.type = 'SYNC_INCREMENTAL'
          and j."errorCode" = 'SYNCBAY_INCREMENTAL_ENQUEUE_FAILED'
          and lower(coalesce(j."errorMessage", '')) like any (
            array[
              '%superato il limite di utilizzo%',
              '%exceeded the usage limit%',
              '%usage limit%',
              '%call limit%',
              '%rate limit%'
            ]
          )
        )
      )
    group by j.type, j.status, j."errorCode"
  ) rows
),
recent_failures as (
  select jsonb_agg(to_jsonb(rows) order by rows."updatedAt" desc) as rows
  from (
    select
      j.type,
      j.status,
      j."errorCode",
      j.attempts,
      j."runAfter",
      j."updatedAt"
    from "SyncJob" j
    join shop_row s on s.id = j."shopId"
    where j.status = 'FAILED'
    order by j."updatedAt" desc
    limit 8
  ) rows
)
select jsonb_build_object(
  'checkedAt', now(),
  'shopDomain', ${sqlString(shopDomain)},
  'staleHours', ${staleHours},
  'openConflictCount', (
    select count(*)::int
    from "SyncConflict" sc
    join shop_row s on s.id = sc."shopId"
    where sc.status = 'OPEN'
  ),
  'staleOpenConflictCount', (
    select count(*)::int
    from "SyncConflict" sc
    join shop_row s on s.id = sc."shopId"
    where sc.status = 'OPEN'
      and sc."detectedAt" < now() - (${staleHours}::text || ' hours')::interval
  ),
  'baselineRepairableDescriptionConflictCount', (select count(*)::int from baseline_repairable_description),
  'alignedDescriptionConflictCount', (select count(*)::int from aligned_description),
  'inactiveMappingConflictCount', (select count(*)::int from inactive_mapping_conflicts),
  'imageRepairableConflictCount', (select count(*)::int from repairable_images),
  'repairableDescriptionConflictCount',
    (select count(*)::int from baseline_repairable_description) +
    (select count(*)::int from aligned_description),
  'repairableConflictCount', (select count(*)::int from repairable_conflicts),
  'conflictRows', coalesce((select rows from conflict_rows), '[]'::jsonb),
  'activeQueueRows', coalesce((select rows from queue_rows), '[]'::jsonb),
  'cooldownRows', coalesce((select rows from cooldown_rows), '[]'::jsonb),
  'recentFailedJobs', coalesce((select rows from recent_failures), '[]'::jsonb)
) as diagnostics;
`;
}

function printReport(report) {
  console.log(`Shop: ${report.shopDomain}`);
  console.log(`Controllo: ${report.checkedAt}`);
  console.log(`Soglia stale: ${report.staleHours} ore`);
  console.log("");
  console.log(`Conflitti aperti: ${report.openConflictCount}`);
  console.log(`Conflitti aperti stale: ${report.staleOpenConflictCount}`);
  console.log(
    `Description riparabili: ${report.repairableDescriptionConflictCount} (${report.alignedDescriptionConflictCount} già allineati, ${report.baselineRepairableDescriptionConflictCount} con baseline da creare)`,
  );
  console.log(
    `Immagini riparabili: ${report.imageRepairableConflictCount ?? 0}`,
  );
  console.log(
    `Mapping inattivi da chiudere: ${report.inactiveMappingConflictCount}`,
  );
  console.log(`Cooldown eBay attivi: ${sumRows(report.cooldownRows)}`);
  console.log("");

  if (report.conflictRows.length > 0) {
    console.log("Conflitti per campo:");
    for (const row of report.conflictRows) {
      console.log(
        `- ${row.status} ${row.field}: ${row.conflictCount} totali, ${row.staleConflictCount} stale`,
      );
    }
    console.log("");
  }

  if (report.cooldownRows.length > 0) {
    console.log("Cooldown provider:");
    for (const row of report.cooldownRows) {
      console.log(
        `- ${row.type} ${row.errorCode}: ${row.jobCount} job, retry da ${row.retryAt}`,
      );
    }
    console.log("");
  }

  const repairableFalsePositives =
    report.repairableDescriptionConflictCount +
    (report.imageRepairableConflictCount ?? 0);
  if (repairableFalsePositives > 0) {
    console.log(
      `Prossimo passo: ${repairableFalsePositives} falsi positivi da baseline superate; risolvili dalla pagina Conflitti (gli script di riparazione una tantum sono stati ritirati).`,
    );
  } else if (report.repairableConflictCount > 0) {
    console.log(
      "Prossimo passo: chiudi i conflitti dei mapping inattivi dalla pagina Conflitti.",
    );
  } else if (
    report.staleOpenConflictCount > 0 ||
    report.cooldownRows.length > 0
  ) {
    console.log(
      "Prossimo passo: attendi il cooldown provider oppure risolvi i conflitti aperti dalla pagina Conflitti.",
    );
  } else {
    console.log("Prossimo passo: nessuna riparazione dedicata richiesta.");
  }
}

function sumRows(rows) {
  return rows.reduce((total, row) => total + Number(row.jobCount ?? 0), 0);
}

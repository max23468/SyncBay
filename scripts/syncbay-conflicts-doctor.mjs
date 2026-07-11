#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  getSupabaseCliCwd,
  getSupabaseCliEnv,
} from "./supabase-cli-env.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";

const execFileAsync = promisify(execFile);

const DEFAULT_STALE_HOURS = 24;
const ACTIVE_JOB_STATUSES = ["PENDING", "RUNNING", "RETRYING"];

const args = parseArgs(process.argv.slice(2));
const shopDomain = resolveRequiredShopDomainOption({
  args,
  env: process.env,
});
const staleHours = args.staleHours ?? DEFAULT_STALE_HOURS;

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
    and pm.status in ('OUT_OF_STOCK', 'ARCHIVED')
),
repairable_images as (
  -- Falsi conflitti immagini da baseline stale: baseline diversa dal valore
  -- Shopify ma una precedente baseline SyncBay aveva già registrato quel
  -- conteggio. Stesso predicato di conflicts:repair-images.
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

  const repairSteps = [];
  if (report.repairableDescriptionConflictCount > 0) {
    repairSteps.push("npm run conflicts:repair-description -- --apply");
  }
  if ((report.imageRepairableConflictCount ?? 0) > 0) {
    repairSteps.push("npm run conflicts:repair-images -- --apply");
  }

  if (repairSteps.length > 0) {
    console.log("Prossimo passo:");
    for (const step of repairSteps) {
      console.log(`- ${step}`);
    }
  } else if (report.repairableConflictCount > 0) {
    console.log(
      "Prossimo passo: chiudi i conflitti dei mapping inattivi dalla pagina Conflitti.",
    );
  } else if (report.staleOpenConflictCount > 0 || report.cooldownRows.length > 0) {
    console.log(
      "Prossimo passo: attendi il cooldown provider oppure risolvi i conflitti aperti dalla pagina Conflitti.",
    );
  } else {
    console.log("Prossimo passo: nessuna riparazione dedicata richiesta.");
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

    if (arg === "--stale-hours") {
      const value = Number.parseInt(rawArgs[index + 1] ?? "", 10);
      parsed.staleHours = Number.isInteger(value) && value > 0 ? value : undefined;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(`Uso: npm run conflicts:doctor -- [--shop dominio.myshopify.com] [--stale-hours 24] [--json]

Diagnostica in sola lettura per conflitti e retry stale. Non stampa valori
prodotto, descrizioni, token o dati cliente.`);
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

function sumRows(rows) {
  return rows.reduce((total, row) => total + Number(row.jobCount ?? 0), 0);
}

#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_SHOP_DOMAIN = "syncbay-dev.myshopify.com";
const DEFAULT_LIMIT = 2000;
const DEFAULT_CHUNK_SIZE = 20;
const SHOPIFY_API_VERSION = "2026-04";
const SHOPIFY_AGENT_ENV = {
  SHOPIFY_CLI_AGENT_IDS: "s:syncbay|r:import-repair-commercial-fields|i:codex",
  SHOPIFY_CLI_AGENT_INFO: "n:codex|v:gpt-5|p:openai",
};

const args = parseArgs(process.argv.slice(2));
const shopDomain =
  args.shop ?? process.env.SHOPIFY_DEV_STORE ?? DEFAULT_SHOP_DOMAIN;
const limit = args.limit ?? DEFAULT_LIMIT;
const chunkSize = args.chunkSize ?? DEFAULT_CHUNK_SIZE;

await main().catch((error) => {
  console.error(
    `Riparazione prezzo/SKU non riuscita: ${formatCliError(error)}`,
  );
  process.exit(1);
});

async function main() {
  const rows = await loadCommercialFields();

  if (rows.length === 0) {
    console.log(`Nessuna variante import da riallineare per ${shopDomain}.`);
    return;
  }

  console.log(
    `Varianti da riallineare: ${rows.length}${args.dryRun ? " (dry-run)" : ""}`,
  );

  if (args.dryRun) {
    for (const row of rows.slice(0, 10)) {
      console.log(
        `- ${row.ebayItemId}: prezzo ${normalizeMoney(row.priceAmount)}, SKU ${row.sku}`,
      );
    }
    return;
  }

  let updatedCount = 0;
  const failures = [];

  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const result = await updateShopifyVariants(chunk);

    updatedCount += result.updatedCount;
    failures.push(...result.failures);
    console.log(
      `Chunk ${Math.floor(index / chunkSize) + 1}/${Math.ceil(
        rows.length / chunkSize,
      )}: aggiornate ${result.updatedCount}/${chunk.length}`,
    );
  }

  if (failures.length > 0) {
    console.log("");
    console.log("Errori:");

    for (const failure of failures.slice(0, 20)) {
      console.log(`- ${failure.ebayItemId}: ${failure.message}`);
    }

    process.exit(1);
  }

  console.log(`Completato: ${updatedCount} varianti aggiornate.`);
}

async function loadCommercialFields() {
  const sql = `
with latest_run as (
  select j.payload->>'catalogImportRunId' as run_id
  from "SyncJob" j
  join "Shop" s on s.id = j."shopId"
  where s."shopDomain" = ${sqlString(shopDomain)}
    and j.type = 'IMPORT_CATALOG'
    and j.payload ? 'catalogImportRunId'
  order by j."createdAt" desc
  limit 1
),
latest_syncbay as (
  select distinct on (ps."mappingId")
    ps."ebayItemId" as "ebayItemId",
    ps."shopifyProductGid" as "shopifyProductGid",
    ps."shopifyVariantGid" as "shopifyVariantGid",
    ps.sku,
    ps."priceAmount"::text as "priceAmount",
    ps."capturedAt"
  from "ProductSnapshot" ps
  join "Shop" s on s.id = ps."shopId"
  join "SyncJob" j on j.id = ps.payload->>'importJobId'
  join latest_run lr on lr.run_id = j.payload->>'catalogImportRunId'
  where s."shopDomain" = ${sqlString(shopDomain)}
    and ps.source = 'SYNCBAY'
    and ps."shopifyProductGid" is not null
    and ps."shopifyVariantGid" is not null
    and ps."priceAmount" is not null
  order by ps."mappingId", ps."capturedAt" desc
)
select jsonb_agg(to_jsonb(latest_syncbay) order by latest_syncbay."capturedAt" desc) as rows
from (
  select *
  from latest_syncbay
  limit ${limit}
) latest_syncbay;
`;
  const diagnostics = await querySupabaseJson(sql);

  return diagnostics.rows?.[0]?.rows ?? [];
}

async function updateShopifyVariants(rows) {
  const variableDeclarations = [];
  const mutationFields = [];
  const variables = {};

  rows.forEach((row, index) => {
    variableDeclarations.push(
      `$productId${index}: ID!`,
      `$variants${index}: [ProductVariantsBulkInput!]!`,
    );
    mutationFields.push(`update${index}: productVariantsBulkUpdate(productId: $productId${index}, variants: $variants${index}) {
      productVariants {
        id
        sku
        price
        inventoryItem {
          id
        }
      }
      userErrors {
        field
        message
      }
    }`);
    variables[`productId${index}`] = row.shopifyProductGid;
    variables[`variants${index}`] = [
      {
        id: row.shopifyVariantGid,
        price: normalizeMoney(row.priceAmount),
      },
    ];
  });

  const mutation = `mutation SyncBayRepairCommercialFields(${variableDeclarations.join(", ")}) {
    ${mutationFields.join("\n")}
  }`;
  const { stdout } = await execFileAsync(
    "shopify",
    [
      "store",
      "execute",
      "--store",
      shopDomain,
      "--version",
      SHOPIFY_API_VERSION,
      "--json",
      "--allow-mutations",
      "--query",
      mutation,
      "--variables",
      JSON.stringify(variables),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...SHOPIFY_AGENT_ENV },
      maxBuffer: 1024 * 1024 * 20,
      timeout: 120_000,
    },
  );
  const parsed = JSON.parse(stdout.slice(findJsonStart(stdout)));
  const skuUpdates = [];
  const failures = [];

  rows.forEach((row, index) => {
    const result = parsed[`update${index}`];
    const userErrors = result?.userErrors ?? [];

    if (userErrors.length > 0) {
      failures.push({
        ebayItemId: row.ebayItemId,
        message: userErrors.map((error) => error.message).join("; "),
      });
      return;
    }

    const variant = result?.productVariants?.[0];

    if (!variant) {
      failures.push({
        ebayItemId: row.ebayItemId,
        message: "Shopify non ha restituito la variante aggiornata.",
      });
      return;
    }

    if (row.sku && !variant.inventoryItem?.id) {
      failures.push({
        ebayItemId: row.ebayItemId,
        message: "Shopify non ha restituito l'inventory item della variante.",
      });
      return;
    }

    if (row.sku && variant.inventoryItem?.id) {
      skuUpdates.push({
        ebayItemId: row.ebayItemId,
        inventoryItemGid: variant.inventoryItem.id,
        sku: row.sku,
      });
    }
  });

  if (skuUpdates.length > 0) {
    const skuResult = await updateShopifyInventorySkus(skuUpdates);

    failures.push(...skuResult.failures);
  }

  return {
    failures,
    updatedCount: rows.length - failures.length,
  };
}

async function updateShopifyInventorySkus(rows) {
  const variableDeclarations = [];
  const mutationFields = [];
  const variables = {};

  rows.forEach((row, index) => {
    variableDeclarations.push(
      `$id${index}: ID!`,
      `$input${index}: InventoryItemInput!`,
    );
    mutationFields.push(`sku${index}: inventoryItemUpdate(id: $id${index}, input: $input${index}) {
      inventoryItem {
        id
        sku
      }
      userErrors {
        field
        message
      }
    }`);
    variables[`id${index}`] = row.inventoryItemGid;
    variables[`input${index}`] = {
      sku: row.sku,
    };
  });

  const mutation = `mutation SyncBayRepairInventorySkus(${variableDeclarations.join(", ")}) {
    ${mutationFields.join("\n")}
  }`;
  const { stdout } = await execFileAsync(
    "shopify",
    [
      "store",
      "execute",
      "--store",
      shopDomain,
      "--version",
      SHOPIFY_API_VERSION,
      "--json",
      "--allow-mutations",
      "--query",
      mutation,
      "--variables",
      JSON.stringify(variables),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...SHOPIFY_AGENT_ENV },
      maxBuffer: 1024 * 1024 * 20,
      timeout: 120_000,
    },
  );
  const parsed = JSON.parse(stdout.slice(findJsonStart(stdout)));
  const failures = [];

  rows.forEach((row, index) => {
    const result = parsed[`sku${index}`];
    const userErrors = result?.userErrors ?? [];

    if (userErrors.length > 0) {
      failures.push({
        ebayItemId: row.ebayItemId,
        message: userErrors.map((error) => error.message).join("; "),
      });
    }
  });

  return { failures };
}

async function querySupabaseJson(sql) {
  const { stdout } = await execFileAsync(
    "npx",
    ["supabase", "db", "query", "--linked", "--output", "json", sql],
    {
      cwd: process.cwd(),
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
    return "timeout durante la query. Riprova tra poco o riduci il carico di query concorrenti.";
  }

  return useful.split("\n").filter(Boolean).slice(0, 3).join(" ");
}

function sanitizeErrorText(value) {
  return String(value)
    .replaceAll(/\nwith latest_run[\s\S]*/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function normalizeMoney(value) {
  const parsed = Number.parseFloat(String(value));

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Prezzo non valido: ${value}`);
  }

  return parsed.toFixed(2);
}

function parseArgs(rawArgs) {
  const parsed = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (arg === "--shop") {
      parsed.shop = rawArgs[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--limit") {
      const limitValue = Number.parseInt(rawArgs[index + 1] ?? "", 10);
      parsed.limit =
        Number.isInteger(limitValue) && limitValue > 0 ? limitValue : undefined;
      index += 1;
      continue;
    }

    if (arg === "--chunk-size") {
      const chunkSizeValue = Number.parseInt(rawArgs[index + 1] ?? "", 10);
      parsed.chunkSize =
        Number.isInteger(chunkSizeValue) && chunkSizeValue > 0
          ? Math.min(chunkSizeValue, 25)
          : undefined;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(`Uso: npm run import:repair-commercial-fields -- [--shop dominio.myshopify.com] [--limit 2000] [--chunk-size 20] [--dry-run]

Riallinea prezzo e SKU della prima variante Shopify dai dati dell'ultima run import.
Usa Supabase CLI linked e Shopify CLI store execute con mutation esplicita.`);
      process.exit(0);
    }

    throw new Error(`Argomento non supportato: ${arg}`);
  }

  return parsed;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

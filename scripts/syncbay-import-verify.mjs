#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildImportRunScopeSql } from "./syncbay-import-run-scope.mjs";
import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";

const execFileAsync = promisify(execFile);

const DEFAULT_SHOP_DOMAIN = "syncbay-dev.myshopify.com";
const DEFAULT_SAMPLE_LIMIT = 10;
const SHOPIFY_API_VERSION = "2026-04";
const SHOPIFY_AGENT_ENV = {
  SHOPIFY_CLI_AGENT_IDS: "s:syncbay|r:import-verify|i:codex",
  SHOPIFY_CLI_AGENT_INFO: "n:codex|v:gpt-5|p:openai",
};

const args = parseArgs(process.argv.slice(2));
const shopDomain =
  args.shop ?? process.env.SHOPIFY_DEV_STORE ?? DEFAULT_SHOP_DOMAIN;
const sampleLimit = args.sample ?? DEFAULT_SAMPLE_LIMIT;
const importRunScopeSql = buildImportRunScopeSql("j");

await main().catch((error) => {
  console.error(`Verifica import non riuscita: ${formatCliError(error)}`);
  process.exit(1);
});

async function main() {
  const expected = await loadExpectedSample();

  if (!expected.runId || expected.rows.length === 0) {
    console.log(`Nessun campione import trovato per ${shopDomain}.`);
    return;
  }

  const actualProducts = await loadShopifyProducts(
    expected.rows.map((row) => row.shopifyProductGid).filter(Boolean),
    expected.defaultLocationGid,
  );
  const checks = expected.rows.map((row) =>
    verifySampleRow(row, actualProducts.get(row.shopifyProductGid)),
  );
  const failedChecks = checks.filter((check) => check.status === "failed");

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          failedCount: failedChecks.length,
          runId: expected.runId,
          sampleCount: checks.length,
          shopDomain,
          checks,
        },
        null,
        2,
      ),
    );
  } else {
    printSummary({
      checks,
      failedCount: failedChecks.length,
      runId: expected.runId,
      shopDomain,
    });
  }

  if (failedChecks.length > 0) {
    process.exit(1);
  }
}

async function loadExpectedSample() {
  const sql = `
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
latest_syncbay as (
  select distinct on (ps."mappingId")
    ps."mappingId",
    ps."ebayItemId",
    ps."shopifyProductGid",
    ps."shopifyVariantGid",
    ps.sku,
    ps.title,
    ps."priceAmount",
    ps.quantity,
    ps."productStatus",
    ps."imageCount",
    ps.payload,
    ps."capturedAt"
  from "ProductSnapshot" ps
  join "Shop" s on s.id = ps."shopId"
  join "SyncJob" j on j.id = ps.payload->>'importJobId'
  join latest_run lr on lr.run_id = ${importRunScopeSql}
  where s."shopDomain" = ${sqlString(shopDomain)}
    and ps.source = 'SYNCBAY'
    and ps."shopifyProductGid" is not null
  order by ps."mappingId", ps."capturedAt" desc
),
sample_rows as (
  select
    sb."ebayItemId" as "ebayItemId",
    sb."shopifyProductGid" as "shopifyProductGid",
    sb."shopifyVariantGid" as "shopifyVariantGid",
    sb.sku,
    sb.title,
    sb."priceAmount"::text as "expectedPrice",
    sb.quantity as "expectedQuantity",
    sb."productStatus" as "expectedProductStatus",
    sb."imageCount" as "expectedImageCount",
    eb."priceAmount"::text as "ebayPrice",
    eb.quantity as "ebayQuantity",
    eb."imageCount" as "ebayImageCount"
  from latest_syncbay sb
  left join lateral (
    select eb."priceAmount", eb.quantity, eb."imageCount"
    from "ProductSnapshot" eb
    where eb."mappingId" = sb."mappingId"
      and eb.source = 'EBAY'
    order by eb."capturedAt" desc
    limit 1
  ) eb on true
  order by sb."capturedAt" desc
  limit ${sampleLimit}
)
select jsonb_build_object(
  'defaultLocationGid', (
    select s."defaultLocationGid"
    from "Shop" s
    where s."shopDomain" = ${sqlString(shopDomain)}
    limit 1
  ),
  'runId', (select run_id from latest_run),
  'rows', coalesce((select jsonb_agg(to_jsonb(sample_rows)) from sample_rows), '[]'::jsonb)
) as result;
`;
  const diagnostics = await querySupabaseJson(sql);
  const payload = diagnostics.rows?.[0]?.result;

  return {
    defaultLocationGid: payload?.defaultLocationGid ?? null,
    rows: payload?.rows ?? [],
    runId: payload?.runId ?? null,
  };
}

async function loadShopifyProducts(productGids, defaultLocationGid) {
  if (productGids.length === 0) return new Map();

  const graphql = defaultLocationGid
    ? `query SyncBayVerifyProducts($ids: [ID!]!, $locationId: ID!) {
  nodes(ids: $ids) {
    ... on Product {
      id
      title
      handle
      status
      totalInventory
      media(first: 50) {
        nodes {
          mediaContentType
          preview {
            status
          }
        }
      }
      variants(first: 1) {
        nodes {
          id
          sku
          price
          inventoryQuantity
          inventoryItem {
            sku
            tracked
            inventoryLevel(locationId: $locationId) {
              quantities(names: ["available"]) {
                name
                quantity
              }
            }
          }
        }
      }
    }
  }
}`
    : `query SyncBayVerifyProducts($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product {
      id
      title
      handle
      status
      totalInventory
      media(first: 50) {
        nodes {
          mediaContentType
          preview {
            status
          }
        }
      }
      variants(first: 1) {
        nodes {
          id
          sku
          price
          inventoryQuantity
          inventoryItem {
            sku
            tracked
          }
        }
      }
    }
  }
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
      "--query",
      graphql,
      "--variables",
      JSON.stringify(
        defaultLocationGid
          ? { ids: productGids, locationId: defaultLocationGid }
          : { ids: productGids },
      ),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...SHOPIFY_AGENT_ENV },
      maxBuffer: 1024 * 1024 * 20,
      timeout: 120_000,
    },
  );
  const parsed = JSON.parse(stdout.slice(findJsonStart(stdout)));
  const products = new Map();

  for (const node of parsed.nodes ?? []) {
    if (node?.id) products.set(node.id, node);
  }

  return products;
}

function verifySampleRow(row, product) {
  const variant = product?.variants?.nodes?.[0] ?? null;
  const locationQuantity = getVariantLocationQuantity(variant);
  const actualQuantity = locationQuantity ?? variant?.inventoryQuantity ?? null;
  const mediaNodes = product?.media?.nodes ?? [];
  const readyImageCount = mediaNodes.filter(
    (media) =>
      media.mediaContentType === "IMAGE" && media.preview?.status === "READY",
  ).length;
  const expectedQuantity = normalizeNumber(row.expectedQuantity);
  const expectedPrice = normalizeMoney(row.expectedPrice);
  const actualPrice = normalizeMoney(variant?.price);
  const expectedImageCount = normalizeNumber(row.expectedImageCount);
  const expectedProductStatus = normalizeProductStatus(
    row.expectedProductStatus,
  );
  const failures = [
    !product ? "prodotto Shopify non trovato" : null,
    product && product.status !== expectedProductStatus
      ? `stato Shopify ${product.status}, atteso ${expectedProductStatus}`
      : null,
    product &&
    expectedQuantity !== null &&
    locationQuantity === null &&
    product.totalInventory !== expectedQuantity
      ? `totalInventory ${product.totalInventory}, atteso ${expectedQuantity}`
      : null,
    variant &&
    expectedQuantity !== null &&
    actualQuantity !== expectedQuantity
      ? `${locationQuantity === null ? "inventoryQuantity" : "locationQuantity"} ${actualQuantity}, atteso ${expectedQuantity}`
      : null,
    variant && !variant.inventoryItem?.tracked
      ? "tracking inventario non attivo"
      : null,
    expectedPrice !== null && actualPrice !== expectedPrice
      ? `prezzo ${actualPrice ?? "assente"}, atteso ${expectedPrice}`
      : null,
    row.sku && variant && variant.inventoryItem?.sku !== row.sku
      ? `SKU ${variant.inventoryItem?.sku ?? "assente"}, atteso ${row.sku}`
      : null,
    expectedImageCount !== null &&
    expectedImageCount > 0 &&
    readyImageCount === 0
      ? "nessuna immagine READY"
      : null,
  ].filter(Boolean);

  return {
    actualImageReadyCount: readyImageCount,
    actualPrice,
    actualQuantity,
    actualQuantitySource: locationQuantity === null ? "variant" : "default_location",
    ebayImageCount: normalizeNumber(row.ebayImageCount),
    ebayItemId: row.ebayItemId,
    expectedImageCount,
    expectedPrice,
    expectedProductStatus,
    expectedQuantity,
    failures,
    handle: product?.handle ?? null,
    shopifyProductGid: row.shopifyProductGid,
    status: failures.length > 0 ? "failed" : "ok",
    title: product?.title ?? row.title,
  };
}

function getVariantLocationQuantity(variant) {
  const availableQuantity = variant?.inventoryItem?.inventoryLevel?.quantities
    ?.find((quantity) => quantity.name === "available")
    ?.quantity;

  return typeof availableQuantity === "number" ? availableQuantity : null;
}

function normalizeProductStatus(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "ACTIVE";
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

function printSummary(input) {
  console.log(`Shop: ${input.shopDomain}`);
  console.log(`Run: ${input.runId}`);
  console.log(
    `Campione: ${input.checks.length} prodotti, ${input.failedCount} con problemi`,
  );
  console.log("");

  for (const check of input.checks) {
    const failures =
      check.failures.length > 0 ? ` - ${check.failures.join("; ")}` : "";

    console.log(
      `- ${check.ebayItemId}: ${check.status}, prezzo ${check.actualPrice}, scorta ${check.actualQuantity}, immagini READY ${check.actualImageReadyCount}${failures}`,
    );
  }
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
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number.parseFloat(String(value));

  return Number.isFinite(parsed) ? parsed.toFixed(2) : null;
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
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

    if (arg === "--sample") {
      const sample = Number.parseInt(rawArgs[index + 1] ?? "", 10);
      parsed.sample =
        Number.isInteger(sample) && sample > 0 ? sample : undefined;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(`Uso: npm run import:verify -- [--shop dominio.myshopify.com] [--sample 10] [--json]

Confronta un campione dell'ultima run import tra snapshot eBay/SyncBay,
mapping ProductMapping e prodotti Shopify live tramite Shopify CLI.
Usa Supabase CLI linked, non richiede DATABASE_URL locale e non stampa segreti.`);
      process.exit(0);
    }

    throw new Error(`Argomento non supportato: ${arg}`);
  }

  return parsed;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

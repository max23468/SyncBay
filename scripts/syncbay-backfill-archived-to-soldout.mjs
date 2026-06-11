#!/usr/bin/env node

// Backfill una-tantum: porta i prodotti già archiviati (mapping ARCHIVED) allo
// stato "esaurito" coerente con ADR 0011, per recuperarne l'indicizzazione SEO.
//
// Per ogni mapping ARCHIVED con prodotto Shopify collegato:
//   - riattiva il prodotto Shopify (status ARCHIVED -> ACTIVE), così l'URL e la
//     pagina tornano serviti e indicizzabili;
//   - azzera la scorta della variante con tracciamento attivo e politica DENY
//     (vetrina "Esaurito", nessun rischio di vendere prodotti non disponibili);
//   - applica il tag `esaurito`;
//   - porta il mapping a OUT_OF_STOCK e registra uno snapshot SyncBay.
//
// Idempotente e ri-eseguibile. Usa `shopify store execute` (auth Shopify CLI) e
// `supabase db query --linked`, come gli altri script operativi del repo.
//
// Uso:
//   npm run catalog:backfill-archived-soldout -- --dry-run
//   npm run catalog:backfill-archived-soldout -- [--shop dominio.myshopify.com] [--limit 2000] [--chunk-size 10]

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";

const execFileAsync = promisify(execFile);

const DEFAULT_SHOP_DOMAIN = "syncbay-dev.myshopify.com";
const DEFAULT_LIMIT = 2000;
const DEFAULT_CHUNK_SIZE = 10;
const SOLD_OUT_TAG = "esaurito";
const SHOPIFY_API_VERSION = "2026-04";
const SHOPIFY_AGENT_ENV = {
  SHOPIFY_CLI_AGENT_IDS: "s:syncbay|r:backfill-archived-to-soldout|i:codex",
  SHOPIFY_CLI_AGENT_INFO: "n:codex|v:claude|p:anthropic",
};

const args = parseArgs(process.argv.slice(2));
const shopDomain =
  args.shop ?? process.env.SHOPIFY_DEV_STORE ?? DEFAULT_SHOP_DOMAIN;
const limit = args.limit ?? DEFAULT_LIMIT;
const chunkSize = args.chunkSize ?? DEFAULT_CHUNK_SIZE;
const referenceDocumentUri = `gid://syncbay/Backfill/${Date.now()}`;

await main().catch((error) => {
  console.error(`Backfill esaurito non riuscito: ${formatCliError(error)}`);
  process.exit(1);
});

async function main() {
  const shop = await loadShop();

  if (!shop) {
    console.log(`Shop non trovato per ${shopDomain}.`);
    return;
  }

  if (!shop.defaultLocationGid) {
    throw new Error(
      "Location Shopify predefinita assente: impossibile azzerare la scorta in modo affidabile.",
    );
  }

  const rows = await loadArchivedMappings(shop.id);

  if (rows.length === 0) {
    console.log(`Nessun prodotto archiviato da portare a esaurito per ${shopDomain}.`);
    return;
  }

  console.log(
    `Prodotti archiviati da portare a esaurito: ${rows.length}${args.dryRun ? " (dry-run)" : ""}`,
  );

  if (args.dryRun) {
    for (const row of rows.slice(0, 10)) {
      console.log(`- ${row.ebayItemId}: ${row.shopifyProductGid} (SKU ${row.sku ?? "—"})`);
    }
    if (rows.length > 10) console.log(`  …e altri ${rows.length - 10}.`);
    console.log("Dry-run: nessuna modifica applicata a Shopify o al database.");
    return;
  }

  const succeededIds = [];
  const failures = [];

  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const lookups = await lookupShopifyVariants(chunk, shop.defaultLocationGid);

    for (const row of chunk) {
      const lookup = lookups.get(row.shopifyProductGid);

      if (!lookup?.variantId || !lookup?.inventoryItemGid) {
        failures.push({
          ebayItemId: row.ebayItemId,
          message: "Variante o inventory item Shopify non disponibile.",
        });
        continue;
      }

      try {
        await markProductSoldOut({
          changeFromQuantity: lookup.availableQuantity,
          inventoryItemGid: lookup.inventoryItemGid,
          locationGid: shop.defaultLocationGid,
          productGid: row.shopifyProductGid,
          variantGid: lookup.variantId,
        });
        succeededIds.push(row.id);
      } catch (error) {
        failures.push({
          ebayItemId: row.ebayItemId,
          message: formatCliError(error),
        });
      }
    }

    console.log(
      `Chunk ${Math.floor(index / chunkSize) + 1}/${Math.ceil(rows.length / chunkSize)}: ` +
        `${succeededIds.length} ok, ${failures.length} errori finora.`,
    );
  }

  if (succeededIds.length > 0) {
    await persistSoldOutMappings(shop.id, succeededIds);
    console.log(`Database aggiornato: ${succeededIds.length} mapping -> OUT_OF_STOCK con snapshot.`);
  }

  if (failures.length > 0) {
    console.log("");
    console.log("Errori:");
    for (const failure of failures.slice(0, 20)) {
      console.log(`- ${failure.ebayItemId}: ${failure.message}`);
    }
    if (failures.length > 20) console.log(`  …e altri ${failures.length - 20}.`);
    process.exit(1);
  }

  console.log(`Completato: ${succeededIds.length} prodotti portati a esaurito.`);
}

async function loadShop() {
  const { rows } = await querySupabaseJson(
    `select id, "defaultLocationGid" from "Shop" where "shopDomain" = ${sqlString(shopDomain)} limit 1;`,
  );
  return rows[0] ?? null;
}

async function loadArchivedMappings(shopId) {
  const { rows } = await querySupabaseJson(
    `select id, "ebayItemId", "shopifyProductGid", "shopifyVariantGid", sku
     from "ProductMapping"
     where "shopId" = ${sqlString(shopId)}
       and status = 'ARCHIVED'
       and "shopifyProductGid" is not null
     order by "updatedAt" asc
     limit ${Number(limit)};`,
  );
  return rows;
}

async function lookupShopifyVariants(chunk, locationGid) {
  const declarations = ["$locationId: ID!", ...chunk.map((_, index) => `$id${index}: ID!`)];
  const fields = chunk.map(
    (_, index) => `p${index}: node(id: $id${index}) {
      ... on Product {
        id
        variants(first: 1) {
          nodes {
            id
            inventoryItem {
              id
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
    }`,
  );
  const variables = { locationId: locationGid };
  chunk.forEach((row, index) => {
    variables[`id${index}`] = row.shopifyProductGid;
  });

  const query = `query SyncBayBackfillLookup(${declarations.join(", ")}) {
    ${fields.join("\n")}
  }`;
  const parsed = await shopifyExecute(query, variables, { allowMutations: false });

  const map = new Map();
  chunk.forEach((row, index) => {
    const node = parsed[`p${index}`];
    const variant = node?.variants?.nodes?.[0];
    const available = variant?.inventoryItem?.inventoryLevel?.quantities?.find(
      (entry) => entry.name === "available",
    )?.quantity;
    map.set(row.shopifyProductGid, {
      availableQuantity: typeof available === "number" ? available : 0,
      inventoryItemGid: variant?.inventoryItem?.id ?? null,
      variantId: variant?.id ?? null,
    });
  });
  return map;
}

async function markProductSoldOut(input) {
  const mutation = `mutation SyncBayBackfillSoldOut(
    $productId: ID!
    $variantId: ID!
    $inventoryItemId: ID!
    $locationId: ID!
    $changeFromQuantity: Int!
    $ref: String!
    $idempotencyKey: String!
  ) {
    status: productUpdate(product: { id: $productId, status: ACTIVE }) {
      product { id status }
      userErrors { field message }
    }
    policy: productVariantsBulkUpdate(
      productId: $productId
      variants: [{ id: $variantId, inventoryPolicy: DENY }]
    ) {
      userErrors { field message }
    }
    tracking: inventoryItemUpdate(id: $inventoryItemId, input: { tracked: true }) {
      userErrors { field message }
    }
    quantity: inventorySetQuantities(
      input: {
        name: "available"
        reason: "correction"
        referenceDocumentUri: $ref
        quantities: [{ inventoryItemId: $inventoryItemId, locationId: $locationId, quantity: 0, changeFromQuantity: $changeFromQuantity }]
      }
    ) @idempotent(key: $idempotencyKey) {
      userErrors { field message }
    }
    tag: tagsAdd(id: $productId, tags: ["${SOLD_OUT_TAG}"]) {
      userErrors { field message }
    }
  }`;

  const parsed = await shopifyExecute(
    mutation,
    {
      changeFromQuantity: input.changeFromQuantity,
      idempotencyKey: `backfill-soldout:${input.inventoryItemGid}:${input.changeFromQuantity}`,
      inventoryItemId: input.inventoryItemGid,
      locationId: input.locationGid,
      productId: input.productGid,
      ref: referenceDocumentUri,
      variantId: input.variantGid,
    },
    { allowMutations: true },
  );

  const errors = [];
  for (const alias of ["status", "policy", "tracking", "quantity", "tag"]) {
    const userErrors = parsed[alias]?.userErrors ?? [];
    for (const userError of userErrors) {
      errors.push(`${alias}: ${userError.message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

async function persistSoldOutMappings(shopId, mappingIds) {
  const idList = mappingIds.map((id) => sqlString(id)).join(", ");
  const sql = `
    update "ProductMapping"
      set status = 'OUT_OF_STOCK',
          "lastErrorCode" = null,
          "lastErrorMessage" = null,
          "lastSyncedAt" = now()
      where "shopId" = ${sqlString(shopId)} and id in (${idList});

    insert into "ProductSnapshot"
      (id, "mappingId", "shopId", "ebayItemId", "shopifyProductGid", "shopifyVariantGid",
       sku, source, "productStatus", quantity, payload)
    select
      gen_random_uuid()::text, m.id, m."shopId", m."ebayItemId", m."shopifyProductGid",
      m."shopifyVariantGid", m.sku, 'SYNCBAY', 'ACTIVE', 0,
      jsonb_build_object('reason', 'ebay_listing_inactive', 'soldOutShopifyProduct', true, 'backfill', true)
    from "ProductMapping" m
    where m."shopId" = ${sqlString(shopId)} and m.id in (${idList});
  `;
  await querySupabaseJson(sql);
}

async function shopifyExecute(queryOrMutation, variables, options) {
  const cliArgs = [
    "shopify",
    "store",
    "execute",
    "--store",
    shopDomain,
    "--version",
    SHOPIFY_API_VERSION,
    "--json",
  ];
  if (options.allowMutations) cliArgs.push("--allow-mutations");
  cliArgs.push("--query", queryOrMutation, "--variables", JSON.stringify(variables));

  const { stdout } = await execFileAsync("npx", cliArgs, {
    cwd: process.cwd(),
    env: { ...process.env, ...SHOPIFY_AGENT_ENV },
    maxBuffer: 1024 * 1024 * 20,
    timeout: 120_000,
  });
  const jsonStart = findJsonStart(stdout);

  if (jsonStart < 0) {
    throw new Error("Shopify CLI non ha restituito JSON.");
  }

  const parsed = JSON.parse(stdout.slice(jsonStart));
  const payload = parsed.data ?? parsed;

  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    throw new Error(parsed.errors.map((error) => error.message).join("; "));
  }

  return payload;
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
    return { rows: [] };
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
    return "Supabase ha bloccato temporaneamente nuove connessioni per troppi tentativi. Attendi qualche minuto e riprova.";
  }

  if (error?.signal === "SIGTERM") {
    return "timeout durante la chiamata. Riprova tra poco o riduci la dimensione del chunk.";
  }

  return useful.split("\n").filter(Boolean).slice(0, 3).join(" ");
}

function sanitizeErrorText(value) {
  return String(value).replaceAll(/\s+/g, " ").trim();
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
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
      parsed.limit = Number.parseInt(rawArgs[index + 1], 10);
      index += 1;
      continue;
    }
    if (arg === "--chunk-size") {
      parsed.chunkSize = Number.parseInt(rawArgs[index + 1], 10);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Uso: npm run catalog:backfill-archived-soldout -- [--shop dominio.myshopify.com] [--limit 2000] [--chunk-size 10] [--dry-run]",
      );
      process.exit(0);
    }
  }

  if (parsed.limit !== undefined && (!Number.isInteger(parsed.limit) || parsed.limit <= 0)) {
    throw new Error("--limit deve essere un intero positivo.");
  }
  if (parsed.chunkSize !== undefined && (!Number.isInteger(parsed.chunkSize) || parsed.chunkSize <= 0)) {
    throw new Error("--chunk-size deve essere un intero positivo.");
  }

  return parsed;
}

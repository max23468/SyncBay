#!/usr/bin/env node
import { parseArgs as parseNodeArgs } from "node:util";

import { querySupabaseJson, sqlQuote } from "./supabase-cli-env.mjs";
import {
  asRecord,
  ensureTokenEncryptionKey,
  getAccessToken,
  getString,
  getTradingItem,
  loadDotEnv,
} from "./syncbay-ebay-cli.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";

const GET_ITEM_CONCURRENCY = 4;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printUsage();
  process.exit(0);
}

loadDotEnv(".env");

const shopDomain = resolveRequiredShopDomainOption({
  args,
  env: process.env,
});

ensureTokenEncryptionKey();

await main().catch((error) => {
  console.error(`Diagnostica categoria negozio non riuscita: ${error.message}`);
  process.exit(1);
});

async function main() {
  const state = await getDiagnosticState();

  if (!state.connection) {
    throw new Error(`Nessuna connessione eBay attiva per ${shopDomain}.`);
  }

  const allMappings = Array.isArray(state.mappings) ? state.mappings : [];
  const mappings = args.limit ? allMappings.slice(0, args.limit) : allMappings;

  if (mappings.length === 0) {
    throw new Error("Nessun mapping ACTIVE da analizzare.");
  }

  const { accessToken } = await getAccessToken(state.connection);
  const results = await mapWithConcurrency(
    mappings,
    GET_ITEM_CONCURRENCY,
    async (mapping) => {
      try {
        const item = await getTradingItem({
          accessToken,
          connection: state.connection,
          itemId: mapping.ebayItemId,
        });
        const storefront = getStorefrontCategory(asRecord(item?.Storefront));

        return {
          ebayItemId: mapping.ebayItemId,
          sku: mapping.sku ?? null,
          shopifyProductGid: mapping.shopifyProductGid ?? null,
          title: getString(item, "Title"),
          storeCategoryId: storefront.storeCategoryId,
          storeCategoryName: storefront.storeCategoryName,
          ok: true,
        };
      } catch (error) {
        return {
          ebayItemId: mapping.ebayItemId,
          sku: mapping.sku ?? null,
          shopifyProductGid: mapping.shopifyProductGid ?? null,
          title: null,
          storeCategoryId: null,
          storeCategoryName: null,
          ok: false,
          errorMessage: error.message,
        };
      }
    },
  );

  const checked = results.filter((row) => row.ok);
  const failed = results.filter((row) => !row.ok);
  const orphans = checked.filter((row) => row.storeCategoryId === null);

  const report = {
    shopDomain,
    activeMappingsTotal: allMappings.length,
    analyzed: mappings.length,
    checkedOk: checked.length,
    lookupFailed: failed.length,
    withStoreCategory: checked.length - orphans.length,
    withoutStoreCategory: orphans.length,
    partial: Boolean(args.limit && args.limit < allMappings.length),
    orphans: orphans.map((row) => ({
      ebayItemId: row.ebayItemId,
      sku: row.sku,
      title: row.title,
    })),
    failures: failed.map((row) => ({
      ebayItemId: row.ebayItemId,
      errorMessage: row.errorMessage,
    })),
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printReport(report);
}

async function getDiagnosticState() {
  const { rows } = await querySupabaseJson(`
with shop_row as (
  select id from "Shop" where "shopDomain" = ${sqlQuote(shopDomain)} limit 1
),
connection as (
  select ec.*
  from "EbayConnection" ec
  join shop_row s on s.id = ec."shopId"
  where ec."marketplaceId" = 'EBAY_IT'
    and ec.status = 'CONNECTED'
  limit 1
),
mappings as (
  select pm."ebayItemId", pm.sku, pm."shopifyProductGid"
  from "ProductMapping" pm
  join shop_row s on s.id = pm."shopId"
  where pm.status = 'ACTIVE'
  order by pm."ebayItemId"
)
select jsonb_build_object(
  'connection', (select to_jsonb(connection) from connection),
  'mappings', coalesce((select jsonb_agg(to_jsonb(mappings)) from mappings), '[]'::jsonb)
) as payload;
`);

  return rows[0]?.payload ?? {};
}

function getStorefrontCategory(storefront) {
  const record = asRecord(storefront);
  if (!record) return { storeCategoryId: null, storeCategoryName: null };

  const rawId = getString(record, "StoreCategoryID");
  const normalizedId =
    rawId && rawId !== "0" && rawId !== "-999" ? rawId : null;
  const name = getString(record, "StoreCategoryName");

  return {
    storeCategoryId: normalizedId,
    storeCategoryName: normalizedId && name && name.length > 0 ? name : null,
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );

  return results;
}

function printReport(report) {
  console.log(`Shop: ${report.shopDomain}`);
  console.log(`Mapping ACTIVE totali: ${report.activeMappingsTotal}`);
  console.log(
    `Analizzati: ${report.analyzed}${report.partial ? " (parziale, usa senza --limit per la lista completa)" : ""}`,
  );
  console.log(`Letti con successo: ${report.checkedOk}`);
  console.log(`Lookup falliti: ${report.lookupFailed}`);
  console.log(`Con categoria negozio: ${report.withStoreCategory}`);
  console.log(`Senza categoria negozio: ${report.withoutStoreCategory}`);
  console.log("");

  if (report.orphans.length > 0) {
    console.log("Listing attivi senza categoria del negozio:");
    for (const orphan of report.orphans) {
      console.log(
        `- ItemID ${orphan.ebayItemId}${orphan.sku ? ` · SKU ${orphan.sku}` : ""}${orphan.title ? ` · ${orphan.title}` : ""}`,
      );
    }
    console.log("");
  } else {
    console.log(
      "Nessun listing attivo senza categoria del negozio nel campione.",
    );
    console.log("");
  }

  if (report.failures.length > 0) {
    console.log("Lookup eBay falliti (riprovare):");
    for (const failure of report.failures) {
      console.log(`- ItemID ${failure.ebayItemId}: ${failure.errorMessage}`);
    }
  }
}

function parseArgs(rawArgs) {
  const { values } = parseNodeArgs({
    args: rawArgs,
    options: {
      help: { short: "h", type: "boolean" },
      json: { type: "boolean" },
      limit: { type: "string" },
      shop: { type: "string" },
    },
  });
  const limit = Number.parseInt(values.limit ?? "", 10);

  return {
    help: values.help,
    json: values.json,
    limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
    shop: values.shop,
  };
}

function printUsage() {
  console.log(`Uso: npm run ebay:store-category-orphans -- [--shop dominio.myshopify.com] [--limit N] [--json]

Diagnostica in sola lettura: per ogni mapping ACTIVE chiama eBay Trading API
GetItem e segnala i listing attivi senza categoria del negozio (quelli non
visibili nella vetrina pubblica eBay). Non scrive su eBay e non modifica i dati
prodotto; aggiorna solo il token eBay cifrato se scaduto. Non stampa segreti.

  --limit N   Analizza solo i primi N mapping (lista parziale rapida).`);
}

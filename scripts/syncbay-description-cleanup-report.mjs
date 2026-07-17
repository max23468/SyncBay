#!/usr/bin/env node
import { parseArgs as parseNodeArgs } from "node:util";

import {
  buildDescriptionCleanupReportRow,
  summarizeDescriptionCleanupReport,
} from "../app/lib/syncbay-description-cleanup.ts";
import { querySupabaseJson, sqlQuote } from "./supabase-cli-env.mjs";
import {
  ensureTokenEncryptionKey,
  getAccessToken,
  getString,
  getTradingItem,
  loadDotEnv,
} from "./syncbay-ebay-cli.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";

const DEFAULT_SAMPLE_LIMIT = 20;
const DEFAULT_MARKETPLACE_ID = "EBAY_IT";

const args = parseArgs(process.argv.slice(2));
loadDotEnv(".env");
if (process.env.SYNCBAY_SUPABASE_CWD) {
  loadDotEnv(`${process.env.SYNCBAY_SUPABASE_CWD}/.env`);
}
args.shop = resolveRequiredShopDomainOption({
  args,
  env: process.env,
});
ensureTokenEncryptionKey();

await main().catch((error) => {
  console.error(`Report pulizia descrizioni non riuscito: ${error.message}`);
  process.exit(1);
});

async function main() {
  const state = await getReportState();

  if (!state.connection) {
    throw new Error(`Connessione eBay ${args.marketplaceId} non trovata.`);
  }

  const { accessToken } = await getAccessToken(state.connection);
  const rows = [];

  for (const candidate of state.candidates) {
    const item = await getTradingItem({
      accessToken,
      connection: state.connection,
      includeItemSpecifics: true,
      itemId: candidate.ebayItemId,
    });

    rows.push(
      buildDescriptionCleanupReportRow({
        descriptionHtml: getString(item, "Description"),
        itemId: candidate.ebayItemId,
        title: candidate.title,
      }),
    );
  }

  const report = {
    shopDomain: args.shop,
    marketplaceId: args.marketplaceId,
    summary: summarizeDescriptionCleanupReport(rows),
    rows,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printReport(report);
}

async function getReportState() {
  const sql = `
with shop_row as (
  select id from "Shop" where "shopDomain" = ${sqlQuote(args.shop)} limit 1
),
connection as (
  select ec.*
  from "EbayConnection" ec
  join shop_row s on s.id = ec."shopId"
  where ec."marketplaceId" = ${sqlQuote(args.marketplaceId)}
    and ec.status = 'CONNECTED'
  limit 1
),
candidates as (
  select
    pm."ebayItemId",
    coalesce(ps.title, pm."ebayItemId") as title
  from "ProductMapping" pm
  join shop_row s on s.id = pm."shopId"
  left join lateral (
    select title
    from "ProductSnapshot" ps
    where ps."mappingId" = pm.id
      and ps.title is not null
    order by ps."capturedAt" desc
    limit 1
  ) ps on true
  where pm."marketplaceId" = ${sqlQuote(args.marketplaceId)}
    and pm.status in ('ACTIVE', 'OUT_OF_STOCK')
  order by pm."updatedAt" desc
  limit ${args.sample}
)
select jsonb_build_object(
  'connection', (select to_jsonb(connection) from connection),
  'candidates', coalesce((select jsonb_agg(to_jsonb(candidates)) from candidates), '[]'::jsonb)
) as payload;
`;
  const { rows } = await querySupabaseJson(sql);
  const payload = rows[0]?.payload ?? {};

  return {
    candidates: Array.isArray(payload.candidates) ? payload.candidates : [],
    connection: payload.connection ?? null,
  };
}

function printReport(report) {
  console.log(`Shop: ${report.shopDomain}`);
  console.log(`Marketplace: ${report.marketplaceId}`);
  console.log(
    `Campione: ${report.summary.sampledCount}; cambiati: ${report.summary.changedCount}; ` +
      `rimozione media: ${report.summary.averageRemovedPercent}%; massima: ${report.summary.maxRemovedPercent}%.`,
  );
  console.log(
    `Segnali template trovati: ${report.summary.templateSignalCount}`,
  );
  console.log("");

  for (const row of report.rows) {
    console.log(`- ${row.itemId} | ${row.title}`);
    console.log(
      `  ${row.rawLength} -> ${row.cleanedLength} caratteri (-${row.removedPercent}%), segnali template ${row.templateSignalCount}.`,
    );
    console.log(`  Pulita: ${row.cleanedTextExcerpt || "vuota"}`);
  }
}

function parseArgs(rawArgs) {
  const { values } = parseNodeArgs({
    args: rawArgs,
    options: {
      help: { short: "h", type: "boolean" },
      json: { type: "boolean" },
      marketplace: { type: "string" },
      sample: { type: "string" },
      shop: { type: "string" },
    },
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  return {
    json: values.json ?? false,
    marketplaceId: values.marketplace ?? DEFAULT_MARKETPLACE_ID,
    sample: parsePositiveInteger(values.sample, DEFAULT_SAMPLE_LIMIT),
    shop: values.shop ?? null,
  };
}

function printUsage() {
  console.log(`Uso: npm run descriptions:cleanup-report -- [--shop dominio.myshopify.com] [--sample 20] [--json]

Esegue un dry-run read-only su un campione di listing eBay collegati e stampa
solo metriche ed estratti sicuri della descrizione pulita.`);
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

#!/usr/bin/env node

import {
  parseRestoreEbayStockArgs,
  shouldCreateRestoreSnapshot,
} from "./syncbay-restore-ebay-stock-args.mjs";
import { querySupabaseJson, sqlQuote } from "./supabase-cli-env.mjs";
import {
  asRecord,
  ensureTokenEncryptionKey,
  escapeXml,
  getAccessToken,
  getString,
  getTradingItem,
  loadDotEnv,
  tradingCall,
} from "./syncbay-ebay-cli.mjs";

const args = parseRestoreEbayStockArgs(process.argv.slice(2));

if (args.help) {
  printUsage();
  process.exit(0);
}

if (!args.confirmRealEbayWrite) {
  console.error(
    "Operazione bloccata: aggiungi --confirm-real-ebay-write per confermare la scrittura reale su eBay.",
  );
  process.exit(1);
}

if (!args.itemId || !args.quantity) {
  printUsage();
  process.exit(1);
}

const targetQuantity = Number(args.quantity);
if (!Number.isInteger(targetQuantity) || targetQuantity < 0) {
  console.error("--quantity deve essere un intero >= 0.");
  process.exit(1);
}

loadDotEnv(".env");
ensureTokenEncryptionKey();

const state = await getRestoreState(args.itemId);

if (!state.mapping) {
  throw new Error(`Mapping non trovato per eBay item ${args.itemId}.`);
}
if (!state.connection || state.connection.status !== "CONNECTED") {
  throw new Error(`Connessione eBay non collegata per item ${args.itemId}.`);
}
if (state.activeCount !== 0) {
  throw new Error(
    `Coda stock/sync non vuota: ${state.activeCount} job attivi. Riprova dopo la chiusura della coda.`,
  );
}

const { accessToken, refreshed } = await getAccessToken(state.connection);

await tradingCall({
  accessToken,
  callName: "ReviseInventoryStatus",
  connection: state.connection,
  requestXml: buildReviseInventoryStatusRequest({
    itemId: args.itemId,
    quantity: targetQuantity,
    sku: args.sku,
  }),
});

const item = await getTradingItem({
  accessToken,
  connection: state.connection,
  itemId: args.itemId,
});
const sellingStatus = asRecord(item?.SellingStatus);
const verifiedQuantity = toNumberOrNull(getString(item, "Quantity"));
const verifiedQuantityAvailable = toNumberOrNull(
  getString(item, "QuantityAvailable"),
);
const verifiedQuantitySold = toNumberOrNull(
  getString(sellingStatus, "QuantitySold"),
);
const verifiedAvailableQuantity =
  verifiedQuantityAvailable ??
  (verifiedQuantity !== null && verifiedQuantitySold !== null
    ? verifiedQuantity - verifiedQuantitySold
    : null);
assertVerifiedAvailableQuantity({
  itemId: args.itemId,
  targetQuantity,
  verifiedAvailableQuantity,
});
const snapshot = shouldCreateRestoreSnapshot(args)
  ? await createRestoreSnapshot({
      itemId: args.itemId,
      latest: state.latest,
      mapping: state.mapping,
      quantity: targetQuantity,
      reason: args.reason ?? "manual_restore_after_real_stock_test",
    })
  : null;

console.log(
  JSON.stringify({
    itemId: args.itemId,
    ok: true,
    snapshotSkipped: !shouldCreateRestoreSnapshot(args),
    snapshot,
    targetQuantity,
    tokenRefreshed: refreshed,
    verifiedAvailableQuantity,
    verifiedQuantity,
    verifiedQuantityAvailable,
    verifiedQuantitySold,
  }),
);

function printUsage() {
  console.log(`Uso:
  npm run stock:restore-ebay -- --item-id <ItemID> --quantity <n> --confirm-real-ebay-write [--sku <sku-eBay-reale>] [--reason <motivo>] [--skip-snapshot]

Esempio:
  npm run stock:restore-ebay -- --item-id 168148953253 --quantity 19 --confirm-real-ebay-write

Lo script:
- blocca l'esecuzione se ci sono job UPDATE_EBAY_STOCK o SYNC_INCREMENTAL attivi;
- usa il token eBay cifrato del runtime e non stampa segreti;
- chiama Trading API ReviseInventoryStatus;
- verifica con GetItem;
- scrive uno snapshot SYNCBAY di ripristino, salvo --skip-snapshot per test eBay esterni controllati.`);
}

async function getRestoreState(itemId) {
  const { rows } = await querySupabaseJson(`
with mapping as (
  select *
  from "ProductMapping"
  where "ebayItemId" = ${sqlQuote(itemId)}
    and "marketplaceId" = 'EBAY_IT'
  limit 1
),
connection as (
  select ec.*
  from "EbayConnection" ec
  join mapping m on m."shopId" = ec."shopId"
  where ec."marketplaceId" = 'EBAY_IT'
  limit 1
),
latest as (
  select ps.*
  from "ProductSnapshot" ps
  join mapping m on m.id = ps."mappingId"
  order by ps."capturedAt" desc
  limit 1
),
active as (
  select count(*)::int as count
  from "SyncJob"
  where status in ('PENDING', 'RUNNING', 'RETRYING')
    and type in ('UPDATE_EBAY_STOCK', 'SYNC_INCREMENTAL')
)
select jsonb_build_object(
  'mapping', (select to_jsonb(mapping) from mapping),
  'connection', (select to_jsonb(connection) from connection),
  'latest', (select to_jsonb(latest) from latest),
  'activeCount', (select count from active)
) as payload;
`);

  return rows[0]?.payload ?? {};
}

async function createRestoreSnapshot(input) {
  const latest = input.latest ?? {};
  const payload = {
    previousQuantity: latest.quantity ?? null,
    reason: input.reason,
    restoredEbayAfterTest: true,
  };
  const { rows } = await querySupabaseJson(`
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
) values (
  concat('codex_restore_', replace(gen_random_uuid()::text, '-', '')),
  ${sqlQuote(input.mapping.shopId)},
  ${sqlQuote(input.mapping.id)},
  'SYNCBAY',
  ${sqlQuote(input.itemId)},
  ${sqlQuote(input.mapping.shopifyProductGid)},
  ${sqlQuote(input.mapping.shopifyVariantGid)},
  ${sqlQuote(input.mapping.sku)},
  ${sqlQuote(latest.title ?? null)},
  ${latest.priceAmount == null ? "null" : `${sqlQuote(latest.priceAmount)}::decimal`},
  ${sqlQuote(latest.currency ?? "EUR")},
  ${input.quantity},
  ${sqlQuote(latest.productStatus ?? null)},
  ${sqlQuote(latest.descriptionHash ?? null)},
  ${latest.imageCount == null ? "null" : Number(latest.imageCount)},
  ${jsonSql(payload)},
  now()
)
returning id, quantity, currency, "capturedAt";
`);

  return rows[0] ?? null;
}

function assertVerifiedAvailableQuantity(input) {
  if (input.verifiedAvailableQuantity === input.targetQuantity) return;

  const actual =
    input.verifiedAvailableQuantity === null
      ? "non verificabile"
      : input.verifiedAvailableQuantity;

  throw new Error(
    `Ripristino eBay non confermato per item ${input.itemId}: disponibilità verificata ${actual}, attesa ${input.targetQuantity}. Snapshot SyncBay non scritto.`,
  );
}

function jsonSql(value) {
  return `${sqlQuote(JSON.stringify(value))}::jsonb`;
}

function buildReviseInventoryStatusRequest(input) {
  const sku = input.sku?.trim();

  return `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>it_IT</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <InventoryStatus>
    <ItemID>${escapeXml(input.itemId)}</ItemID>
    ${sku ? `<SKU>${escapeXml(sku)}</SKU>` : ""}
    <Quantity>${input.quantity}</Quantity>
  </InventoryStatus>
</ReviseInventoryStatusRequest>`;
}

function toNumberOrNull(value) {
  if (value == null) return null;

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

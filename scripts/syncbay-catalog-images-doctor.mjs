#!/usr/bin/env node
import { parseArgs as parseNodeArgs } from "node:util";

import { mapWithConcurrency } from "../app/lib/map-with-concurrency.ts";
import { asEbayTradingRecord as asRecord } from "../app/lib/syncbay-ebay-trading.ts";
import { getEbayTradingItem as getTradingItem } from "../app/services/ebay-trading-api.server.ts";
import { querySupabaseJson, sqlQuote } from "./supabase-cli-env.mjs";
import { ensureTokenEncryptionKey, getAccessToken, loadDotEnv } from "./syncbay-ebay-cli.mjs";
import { resolveRequiredShopDomainOption } from "./syncbay-shop-domain-option.mjs";

const DEFAULT_LIMIT = 20;
const DEFAULT_EBAY_LIMIT = 10;

let args = null;
let shopDomain = null;

if (import.meta.main) {
  args = parseArgs(process.argv.slice(2));
  loadDotEnv(".env");
  shopDomain = resolveCatalogImagesDoctorShopDomain({
    args,
    env: process.env,
  });
  ensureTokenEncryptionKey();

  await main().catch((error) => {
    console.error(`Diagnostica immagini Catalogo non riuscita: ${error.message}`);
    process.exit(1);
  });
}

async function main() {
  const state = await getDiagnosticState();

  if (!state.connection) {
    throw new Error(`Nessuna connessione eBay attiva per ${shopDomain}.`);
  }

  const rows = Array.isArray(state.rows) ? state.rows : [];
  const noImageRows = rows.filter(
    (row) => !row.hasAnyPayloadUrl && Number(row.latestImageCount ?? 0) === 0,
  );
  const checkedRows = noImageRows.slice(0, args.ebayLimit);
  const { accessToken } = await getAccessToken(state.connection);
  const ebayChecks = await mapWithConcurrency(checkedRows, 3, async (row) => {
    try {
      const item = await getTradingItem({
        accessToken,
        connection: state.connection,
        itemId: row.ebayItemId,
      });
      const imageCount = getTradingImageUrls(item).length;

      return {
        imageCount,
        ok: true,
        position: row.position,
      };
    } catch (error) {
      return {
        errorMessage: error.message,
        imageCount: null,
        ok: false,
        position: row.position,
      };
    }
  });
  const report = {
    shopDomain,
    limit: args.limit,
    summary: state.summary,
    firstRows: rows.map((row) => ({
      hasAnyPayloadUrl: Boolean(row.hasAnyPayloadUrl),
      latestImageCount: Number(row.latestImageCount ?? 0),
      latestSource: row.latestSource ?? null,
      position: row.position,
    })),
    ebayLiveCheck: {
      checked: ebayChecks.length,
      failed: ebayChecks.filter((row) => !row.ok).length,
      withImages: ebayChecks.filter((row) => Number(row.imageCount ?? 0) > 0).length,
      withoutImages: ebayChecks.filter((row) => row.ok && row.imageCount === 0).length,
      rows: ebayChecks,
    },
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
catalog as (
  select
    row_number() over (order by pm.status asc, pm."updatedAt" desc) as position,
    pm.id,
    pm."ebayItemId",
    pm."shopifyProductGid",
    pm.status,
    pm."updatedAt"
  from "ProductMapping" pm
  join shop_row s on s.id = pm."shopId"
  where pm."marketplaceId" = 'EBAY_IT'
),
first_rows as (
  select *
  from catalog
  order by status asc, "updatedAt" desc
  limit ${args.limit}
),
latest_any as (
  select distinct on (ps."mappingId")
    ps."mappingId",
    ps.source,
    ps."imageCount",
    ps.payload
  from "ProductSnapshot" ps
  join catalog c on c.id = ps."mappingId"
  order by ps."mappingId", ps."capturedAt" desc
),
latest_ebay as (
  select distinct on (ps."mappingId")
    ps."mappingId",
    ps."imageCount"
  from "ProductSnapshot" ps
  join catalog c on c.id = ps."mappingId"
  where ps.source = 'EBAY'
  order by ps."mappingId", ps."capturedAt" desc
),
latest_syncbay as (
  select distinct on (ps."mappingId")
    ps."mappingId",
    ps."imageCount"
  from "ProductSnapshot" ps
  join catalog c on c.id = ps."mappingId"
  where ps.source = 'SYNCBAY'
  order by ps."mappingId", ps."capturedAt" desc
),
any_payload_with_url as (
  select distinct ps."mappingId"
  from "ProductSnapshot" ps
  join catalog c on c.id = ps."mappingId"
  where (
    jsonb_typeof(ps.payload->'imageUrls') = 'array'
    and jsonb_array_length(ps.payload->'imageUrls') > 0
  ) or (
    jsonb_typeof(ps.payload#>'{mediaSync,sourceImageUrls}') = 'array'
    and jsonb_array_length(ps.payload#>'{mediaSync,sourceImageUrls}') > 0
  ) or coalesce(
    ps.payload->>'thumbnailUrl',
    ps.payload->>'imageUrl',
    ps.payload->>'galleryUrl',
    ps.payload->>'GalleryURL'
  ) is not null
),
scoped as (
  select
    'all' as scope,
    c.id,
    c."shopifyProductGid",
    la.source as latest_source,
    la."imageCount" as latest_image_count,
    le."imageCount" as ebay_image_count,
    ls."imageCount" as syncbay_image_count,
    ap."mappingId" is not null as has_any_payload_url
  from catalog c
  left join latest_any la on la."mappingId" = c.id
  left join latest_ebay le on le."mappingId" = c.id
  left join latest_syncbay ls on ls."mappingId" = c.id
  left join any_payload_with_url ap on ap."mappingId" = c.id
  union all
  select
    'first_page' as scope,
    c.id,
    c."shopifyProductGid",
    la.source as latest_source,
    la."imageCount" as latest_image_count,
    le."imageCount" as ebay_image_count,
    ls."imageCount" as syncbay_image_count,
    ap."mappingId" is not null as has_any_payload_url
  from (select * from catalog order by status asc, "updatedAt" desc limit 50) c
  left join latest_any la on la."mappingId" = c.id
  left join latest_ebay le on le."mappingId" = c.id
  left join latest_syncbay ls on ls."mappingId" = c.id
  left join any_payload_with_url ap on ap."mappingId" = c.id
)
select jsonb_build_object(
  'connection', (select to_jsonb(connection) from connection),
  'summary', coalesce((
    select jsonb_agg(to_jsonb(summary) order by scope)
    from (
      select
        scope,
        count(*)::int as "mappingCount",
        count(*) filter (where "shopifyProductGid" is not null)::int as "withShopifyProduct",
        count(*) filter (where coalesce(latest_image_count, 0) > 0)::int as "latestSnapshotImageCountPositive",
        count(*) filter (where coalesce(ebay_image_count, 0) > 0)::int as "latestEbayImageCountPositive",
        count(*) filter (where coalesce(syncbay_image_count, 0) > 0)::int as "latestSyncBayImageCountPositive",
        count(*) filter (where has_any_payload_url)::int as "anySnapshotPayloadUrl"
      from scoped
      group by scope
    ) summary
  ), '[]'::jsonb),
  'rows', coalesce((
    select jsonb_agg(to_jsonb(row) order by position)
    from (
      select
        fr.position,
        fr."ebayItemId" as "ebayItemId",
        la.source as "latestSource",
        coalesce(la."imageCount", 0) as "latestImageCount",
        ap."mappingId" is not null as "hasAnyPayloadUrl"
      from first_rows fr
      left join latest_any la on la."mappingId" = fr.id
      left join any_payload_with_url ap on ap."mappingId" = fr.id
    ) row
  ), '[]'::jsonb)
) as payload;
`);

  return rows[0]?.payload ?? {};
}

function getTradingImageUrls(item) {
  const pictureDetails = asRecord(item?.PictureDetails);
  const directUrls = asArray(pictureDetails?.PictureURL).flatMap((url) => {
    const text = normalizeText(toText(url));
    return text ? [text] : [];
  });

  if (directUrls.length > 0) return directUrls;

  const variations = asRecord(item?.Variations);
  const pictures = asRecord(variations?.Pictures);
  const pictureSets = asArray(pictures?.VariationSpecificPictureSet);

  return pictureSets.flatMap((pictureSet) => {
    const record = asRecord(pictureSet);
    return asArray(record?.PictureURL).flatMap((url) => {
      const text = normalizeText(toText(url));
      return text ? [text] : [];
    });
  });
}

function printReport(report) {
  console.log(`Shop: ${report.shopDomain}`);
  console.log(`Righe vista analizzate: ${report.limit}`);
  console.log("");

  for (const row of report.summary ?? []) {
    console.log(
      `${row.scope}: mapping ${row.mappingCount}, Shopify ${row.withShopifyProduct}, ` +
        `snapshot con immagini ${row.latestSnapshotImageCountPositive}, ` +
        `eBay con immagini ${row.latestEbayImageCountPositive}, ` +
        `SyncBay con immagini ${row.latestSyncBayImageCountPositive}, ` +
        `payload URL ${row.anySnapshotPayloadUrl}`,
    );
  }

  console.log("");
  console.log(
    `Prime ${report.firstRows.length} righe: ` +
      `${report.firstRows.filter((row) => row.hasAnyPayloadUrl).length} con URL immagine in snapshot, ` +
      `${report.firstRows.filter((row) => row.latestImageCount > 0).length} con imageCount > 0.`,
  );
  console.log(
    `eBay live sulle righe senza immagine: ${report.ebayLiveCheck.checked} controllate, ` +
      `${report.ebayLiveCheck.withImages} ora hanno immagini, ` +
      `${report.ebayLiveCheck.withoutImages} restano senza immagini, ` +
      `${report.ebayLiveCheck.failed} lookup falliti.`,
  );

  if (report.ebayLiveCheck.withImages > 0) {
    const positions = report.ebayLiveCheck.rows
      .filter((row) => Number(row.imageCount ?? 0) > 0)
      .map((row) => row.position)
      .join(", ");
    console.log(`Righe da riparare/backfill candidate: ${positions}.`);
  }
}

function parseArgs(rawArgs) {
  const { values } = parseNodeArgs({
    args: rawArgs,
    options: {
      "ebay-limit": { type: "string" },
      help: { short: "h", type: "boolean" },
      json: { type: "boolean" },
      limit: { type: "string" },
      shop: { type: "string" },
    },
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  return {
    ebayLimit: parsePositiveInt(values["ebay-limit"], DEFAULT_EBAY_LIMIT),
    json: values.json,
    limit: parsePositiveInt(values.limit, DEFAULT_LIMIT),
    shop: values.shop,
  };
}

export function resolveCatalogImagesDoctorShopDomain(input) {
  return resolveRequiredShopDomainOption(input);
}

function printUsage() {
  console.log(`Uso: npm run catalog:images:doctor -- [--shop dominio.myshopify.com] [--limit N] [--ebay-limit N] [--json]

Diagnostica in sola lettura: misura copertura immagini nel Catalogo SyncBay e
controlla con Trading API GetItem se le prime righe senza immagine hanno oggi
immagini disponibili su eBay. Non stampa URL, titoli o segreti.`);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toText(value) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  const record = asRecord(value);
  const text = record?.["#text"];

  return typeof text === "string" || typeof text === "number" ? String(text) : "";
}

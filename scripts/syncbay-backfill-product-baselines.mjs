#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";

const rawArgs = process.argv.slice(2);
const apply = rawArgs.includes("--apply");
const confirmed = rawArgs.includes("--confirm-apply");
if (apply !== confirmed) throw new Error("La scrittura richiede insieme --apply e --confirm-apply.");
const afterIndex = rawArgs.indexOf("--after-mapping-id");
const afterMappingId = afterIndex >= 0 ? rawArgs[afterIndex + 1] : "";
if (afterIndex >= 0 && !afterMappingId) throw new Error("--after-mapping-id richiede un ID.");
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

const writeCte = apply ? `, written as (
  insert into "ProductSyncBaseline" (
    "mappingId", "shopId", "shopifyProductGid", "shopifyVariantGid",
    "shopifyInventoryItemGid", title, "descriptionHash", "priceAmount",
    "compareAtPriceAmount", currency, quantity, "productStatus", "imageCount",
    "productFacets", "lastWriterJobId", "createdAt", "updatedAt"
  )
  select "mappingId", "shopId", "shopifyProductGid", "shopifyVariantGid",
    "shopifyInventoryItemGid", title, "descriptionHash", "priceAmount",
    "compareAtPriceAmount", currency, quantity, "productStatus", "imageCount",
    "productFacets", "lastWriterJobId", now(), now()
  from reconstructed
  on conflict ("mappingId") do update set
    "shopId"=excluded."shopId", "shopifyProductGid"=excluded."shopifyProductGid",
    "shopifyVariantGid"=excluded."shopifyVariantGid",
    "shopifyInventoryItemGid"=excluded."shopifyInventoryItemGid",
    title=coalesce(excluded.title, "ProductSyncBaseline".title),
    "descriptionHash"=coalesce(excluded."descriptionHash", "ProductSyncBaseline"."descriptionHash"),
    "priceAmount"=coalesce(excluded."priceAmount", "ProductSyncBaseline"."priceAmount"),
    "compareAtPriceAmount"=coalesce(excluded."compareAtPriceAmount", "ProductSyncBaseline"."compareAtPriceAmount"),
    currency=coalesce(excluded.currency, "ProductSyncBaseline".currency),
    quantity=coalesce(excluded.quantity, "ProductSyncBaseline".quantity),
    "productStatus"=coalesce(excluded."productStatus", "ProductSyncBaseline"."productStatus"),
    "imageCount"=coalesce(excluded."imageCount", "ProductSyncBaseline"."imageCount"),
    "productFacets"=coalesce(excluded."productFacets", "ProductSyncBaseline"."productFacets"),
    "lastWriterJobId"=coalesce(excluded."lastWriterJobId", "ProductSyncBaseline"."lastWriterJobId"),
    "updatedAt"=now()
  returning "mappingId"
)` : "";

const sql = `with selected as (
  select m.* from "ProductMapping" m where m.id > ${quote(afterMappingId)} order by m.id limit 500
), reconstructed as (
  select m.id as "mappingId", m."shopId", m."shopifyProductGid", m."shopifyVariantGid",
    m."shopifyInventoryItemGid",
    (array_agg(s.title order by s."capturedAt" desc) filter (where s.title is not null))[1] as title,
    (array_agg(s."descriptionHash" order by s."capturedAt" desc) filter (where s."descriptionHash" is not null))[1] as "descriptionHash",
    (array_agg(s."priceAmount" order by s."capturedAt" desc) filter (where s."priceAmount" is not null))[1] as "priceAmount",
    (array_agg(nullif(s.payload #>> '{pricing,compareAtPriceAmount}', '') order by s."capturedAt" desc) filter (where nullif(s.payload #>> '{pricing,compareAtPriceAmount}', '') is not null))[1]::decimal(12,2) as "compareAtPriceAmount",
    (array_agg(s.currency order by s."capturedAt" desc) filter (where s.currency is not null))[1] as currency,
    (array_agg(s.quantity order by s."capturedAt" desc) filter (where s.quantity is not null))[1] as quantity,
    (array_agg(s."productStatus" order by s."capturedAt" desc) filter (where s."productStatus" is not null))[1] as "productStatus",
    (array_agg(s."imageCount" order by s."capturedAt" desc) filter (where s."imageCount" is not null))[1] as "imageCount",
    (array_agg(s.payload->'productFacets' order by s."capturedAt" desc) filter (where s.payload ? 'productFacets'))[1] as "productFacets",
    (array_agg(nullif(s.payload->>'syncJobId', '') order by s."capturedAt" desc) filter (where nullif(s.payload->>'syncJobId', '') is not null))[1] as "lastWriterJobId"
  from selected m left join "ProductSnapshot" s on s."mappingId"=m.id and s.source='SYNCBAY'
  group by m.id, m."shopId", m."shopifyProductGid", m."shopifyVariantGid", m."shopifyInventoryItemGid"
)
${writeCte}
select jsonb_build_object('mode', ${quote(apply ? "apply" : "dry-run")},
  'scanned', (select count(*)::int from selected),
  'candidate', (select count(*)::int from reconstructed),
  'alreadySet', (select count(*)::int from reconstructed r join "ProductSyncBaseline" b on b."mappingId"=r."mappingId"),
  'written', ${apply ? "(select count(*)::int from written)" : "0"},
  'lastMappingId', (select max(id) from selected)) as result;`;

const { stdout } = await promisify(execFile)("npx", ["supabase", "db", "query", "--linked", "--output", "json", sql], {
  env: await getSupabaseCliEnv(), maxBuffer: 10 * 1024 * 1024, timeout: 90_000,
});
const start = Math.min(...[stdout.indexOf("{"), stdout.indexOf("[")].filter((value) => value >= 0));
if (!Number.isFinite(start)) throw new Error("Supabase CLI non ha restituito JSON.");
const parsed = JSON.parse(stdout.slice(start));
const result = (parsed.rows ?? parsed)?.[0]?.result ?? {};
console.log(JSON.stringify(result));

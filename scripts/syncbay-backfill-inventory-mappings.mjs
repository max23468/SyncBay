#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";

const execFileAsync = promisify(execFile);
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const confirmed = args.has("--confirm-apply");

if (apply !== confirmed) {
  throw new Error("La scrittura richiede insieme --apply e --confirm-apply.");
}

const applyCte = apply
  ? `, updated AS (
      UPDATE "ProductMapping" mapping
      SET "shopifyInventoryItemGid" = base."inventoryItemGid",
          "updatedAt" = now()
      FROM base
      WHERE mapping.id = base.id
        AND base."existingGid" IS NULL
        AND base."inventoryItemGid" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "ProductMapping" occupied
          WHERE occupied."shopId" = base."shopId"
            AND occupied.id <> base.id
            AND occupied."shopifyInventoryItemGid" = base."inventoryItemGid"
        )
      RETURNING mapping.id
    )`
  : "";
const sql = `
  WITH base AS MATERIALIZED (
    SELECT
      mapping.id,
      mapping."shopId",
      mapping."shopifyInventoryItemGid" AS "existingGid",
      NULLIF(BTRIM(snapshot."inventoryItemGid"), '') AS "inventoryItemGid"
    FROM "ProductMapping" mapping
    LEFT JOIN LATERAL (
      SELECT product_snapshot."payload" #>> '{inventorySync,inventoryItemGid}' AS "inventoryItemGid"
      FROM "ProductSnapshot" product_snapshot
      WHERE product_snapshot."mappingId" = mapping.id
        AND product_snapshot."source" = 'SYNCBAY'::"ProductSnapshotSource"
        AND NULLIF(BTRIM(product_snapshot."payload" #>> '{inventorySync,inventoryItemGid}'), '') IS NOT NULL
      ORDER BY product_snapshot."capturedAt" DESC
      LIMIT 1
    ) snapshot ON TRUE
  )
  ${applyCte}
  SELECT jsonb_build_object(
    'scanned', count(*)::int,
    'candidate', count(*) FILTER (
      WHERE "existingGid" IS NULL AND "inventoryItemGid" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "ProductMapping" occupied
          WHERE occupied."shopId" = base."shopId"
            AND occupied.id <> base.id
            AND occupied."shopifyInventoryItemGid" = base."inventoryItemGid"
        )
    )::int,
    'alreadySet', count(*) FILTER (WHERE "existingGid" = "inventoryItemGid")::int,
    'conflicting', count(*) FILTER (
      WHERE "inventoryItemGid" IS NOT NULL
        AND "existingGid" IS DISTINCT FROM "inventoryItemGid"
        AND (
          "existingGid" IS NOT NULL OR EXISTS (
            SELECT 1 FROM "ProductMapping" occupied
            WHERE occupied."shopId" = base."shopId"
              AND occupied.id <> base.id
              AND occupied."shopifyInventoryItemGid" = base."inventoryItemGid"
          )
        )
    )::int,
    'missing', count(*) FILTER (WHERE "inventoryItemGid" IS NULL)::int
  ) AS result
  FROM base;
`;

const { stdout } = await execFileAsync(
  "npx",
  ["supabase", "db", "query", "--linked", "--output", "json", sql],
  {
    env: await getSupabaseCliEnv(),
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60_000,
  },
);
const jsonStart = Math.min(
  ...[stdout.indexOf("{"), stdout.indexOf("[")].filter((index) => index >= 0),
);
if (!Number.isFinite(jsonStart)) throw new Error("Supabase CLI non ha restituito JSON.");
const parsed = JSON.parse(stdout.slice(jsonStart));
const result = (parsed.rows ?? parsed)?.[0]?.result ?? {};

for (const key of ["scanned", "candidate", "alreadySet", "conflicting", "missing"]) {
  console.log(`${key}: ${Number(result[key] ?? 0)}`);
}

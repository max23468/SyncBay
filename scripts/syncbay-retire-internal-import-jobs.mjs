#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const confirmed = args.includes("--confirm-apply");

if (apply !== confirmed) {
  throw new Error("La scrittura richiede insieme --apply e --confirm-apply.");
}

const writeCte = apply
  ? `, retired as (
      update "SyncJob"
      set status = 'CANCELLED',
          "finishedAt" = coalesce("finishedAt", now()),
          "errorCode" = 'SYNCBAY_LEGACY_IMPORT_RETIRED',
          "errorMessage" = 'Traccia interna import legacy ritirata dopo unificazione del ciclo vita.',
          "updatedAt" = now()
      where id in (select id from candidates)
      returning id
    )`
  : "";
const sql = `with candidates as (
  select id
  from "SyncJob"
  where "idempotencyKey" like 'draft-import:%'
    and (status in ('SUCCEEDED', 'FAILED')
      or (status in ('RUNNING', 'RETRYING') and coalesce("startedAt", "createdAt") < now() - interval '15 minutes'))
)
${writeCte}
select jsonb_build_object(
  'mode', '${apply ? "apply" : "dry-run"}',
  'candidates', (select count(*)::int from candidates),
  'retired', ${apply ? "(select count(*)::int from retired)" : "0"}
) as result;`;

const { stdout } = await promisify(execFile)(
  "npx",
  ["supabase", "db", "query", "--linked", "--output", "json", sql],
  {
    cwd: process.env.SYNCBAY_SUPABASE_CWD || process.cwd(),
    env: await getSupabaseCliEnv(),
    maxBuffer: 10 * 1024 * 1024,
    timeout: 90_000,
  },
);
const start = Math.min(
  ...[stdout.indexOf("{"), stdout.indexOf("[")].filter((value) => value >= 0),
);
if (!Number.isFinite(start)) throw new Error("Supabase CLI non ha restituito JSON.");
const parsed = JSON.parse(stdout.slice(start));
console.log(JSON.stringify((parsed.rows ?? parsed)?.[0]?.result ?? {}));

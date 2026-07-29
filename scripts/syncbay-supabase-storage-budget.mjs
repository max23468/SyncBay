#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSupabaseCliCwd, getSupabaseCliEnv, getSupabaseCliPath } from "./supabase-cli-env.mjs";
import { buildSupabaseStorageObservation } from "./syncbay-provider-observations.mjs";

const FREE_STORAGE_BYTES = 1_000_000_000;
const sql = `
select
  count(*)::bigint as "objectCount",
  coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::bigint else 0 end), 0)::bigint as bytes
from storage.objects;
`;

const { stdout } = await promisify(execFile)(
  getSupabaseCliPath(),
  ["db", "query", "--linked", "--output", "json", sql],
  {
    cwd: getSupabaseCliCwd(),
    env: await getSupabaseCliEnv(),
    maxBuffer: 1024 * 1024,
    timeout: 45_000,
  },
);
const start = Math.min(...[stdout.indexOf("{"), stdout.indexOf("[")].filter((value) => value >= 0));
const parsed = JSON.parse(stdout.slice(start));
const row = (parsed.rows ?? parsed)?.[0] ?? {};
const observation = buildSupabaseStorageObservation({
  bytes: row.bytes,
  objectCount: row.objectCount,
  quotaBytes: FREE_STORAGE_BYTES,
});

console.log(JSON.stringify(observation));

if (observation.status === "blocked") process.exitCode = 3;
else if (observation.status === "urgent") process.exitCode = 2;

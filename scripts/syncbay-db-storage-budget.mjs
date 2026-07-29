#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSupabaseCliCwd, getSupabaseCliEnv, getSupabaseCliPath } from "./supabase-cli-env.mjs";

const sql = `select pg_database_size(current_database())::bigint as bytes;`;
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
const bytes = Number((parsed.rows ?? parsed)?.[0]?.bytes ?? 0);
const mib = bytes / 1024 / 1024;
const status = mib >= 450 ? "blocked" : mib >= 400 ? "urgent" : mib >= 350 ? "warning" : "ok";
console.log(JSON.stringify({ bytes, mib: Number(mib.toFixed(1)), status }));
if (status === "blocked") process.exitCode = 3;
else if (status === "urgent") process.exitCode = 2;

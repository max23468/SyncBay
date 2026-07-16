#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  observeVercel,
} from "./syncbay-provider-observations.mjs";

const run = async (script, args = []) => {
  try {
    const { stdout } = await promisify(execFile)("node", [script, ...args], { maxBuffer: 5 * 1024 * 1024, timeout: 60_000 });
    const output = stdout.trim();
    try {
      return { status: "observed", value: JSON.parse(output) };
    } catch {
      return { status: "observed", output: output.split("\n").at(-1) ?? "" };
    }
  } catch (error) {
    const output = String(error.stdout ?? "").trim();
    try {
      return { status: "observed", value: JSON.parse(output), exitCode: error.code ?? 1 };
    } catch {
      // Il comando non ha prodotto un report JSON recuperabile.
    }
    return { status: "error", exitCode: error.code ?? 1 };
  }
};

const database = await run("scripts/syncbay-db-storage-budget.mjs");
const egress = await run("scripts/syncbay-egress-budget.mjs", ["--json"]);
const supabaseFileStorage = await run("scripts/syncbay-supabase-storage-budget.mjs");
const vercel = await observeVercel();
const result = {
  database,
  egress,
  supabase: {
    plan: {
      status: "dashboard_required",
      expected: "free",
      action: "verify_supabase_organization_plan",
    },
    fileStorage: supabaseFileStorage,
    egress: {
      status: "dashboard_required",
      reason: "provider_meter_not_exposed_by_cli",
      quota: { uncachedGb: 5, cachedGb: 5 },
      action: "verify_supabase_organization_usage",
    },
  },
  vercel,
};
console.log(JSON.stringify(result));
if (
  database.status === "error" ||
  egress.status === "error" ||
  supabaseFileStorage.status === "error" ||
  ["urgent", "blocked"].includes(database.value?.status) ||
  ["urgent", "blocked"].includes(supabaseFileStorage.value?.status)
) process.exitCode = 2;

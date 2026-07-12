#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
    return { status: "error", exitCode: error.code ?? 1 };
  }
};

const database = await run("scripts/syncbay-db-storage-budget.mjs");
const egress = await run("scripts/syncbay-egress-budget.mjs", ["--json"]);
const vercelPlan = process.env.VERCEL_PLAN?.trim().toLowerCase() || "unknown";
const commercialUse = process.env.SYNCBAY_COMMERCIAL_USE?.trim().toLowerCase() === "true";
const planEligibility = vercelPlan === "hobby" && commercialUse ? "blocked" : vercelPlan === "unknown" ? "unknown" : "ok";
const result = {
  database,
  egress,
  planEligibility,
  supabaseFileStorage: { status: "unknown", action: "verify_dashboard" },
  vercel: {
    plan: vercelPlan,
    usage: { status: "unknown", action: "verify_dashboard" },
  },
};
console.log(JSON.stringify(result));
if (planEligibility === "blocked" || database.status === "error" || egress.status === "error") process.exitCode = 2;

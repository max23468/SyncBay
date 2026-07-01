#!/usr/bin/env node
import { spawnSync } from "node:child_process";

import {
  getSupabaseCliCwd,
  getSupabaseCliEnv,
} from "./supabase-cli-env.mjs";

const VALID_TYPES = new Set(["security", "performance"]);

if (isCliEntrypoint()) {
  const advisorType = parseAdvisorType(process.argv.slice(2));
  const result = spawnSync(
    "npx",
    ["supabase", "db", "advisors", "--linked", "--type", advisorType],
    {
      cwd: getSupabaseCliCwd(),
      env: await getSupabaseCliEnv(),
      stdio: "inherit",
    },
  );

  if (result.error) {
    console.error(`Advisor Supabase non eseguibile: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

export function parseAdvisorType(rawArgs) {
  const advisorType = rawArgs[0];

  if (!VALID_TYPES.has(advisorType)) {
    throw new Error(
      "Uso: node scripts/syncbay-supabase-advisors.mjs security|performance",
    );
  }

  return advisorType;
}

function isCliEntrypoint() {
  return process.argv[1]?.endsWith("syncbay-supabase-advisors.mjs") ?? false;
}

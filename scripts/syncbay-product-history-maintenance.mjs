#!/usr/bin/env node

import { runDailyOperationalMaintenance } from "../app/services/product-history.server.ts";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const confirmed = args.has("--confirm-apply");
if (apply !== confirmed)
  throw new Error("La scrittura richiede insieme --apply e --confirm-apply.");

const result = await runDailyOperationalMaintenance({ dryRun: !apply });
console.log(JSON.stringify(result));

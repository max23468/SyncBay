#!/usr/bin/env node

import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  SUPABASE_HTTP_SERVICE_CHECKS,
  buildSupabaseServiceHeaders,
  classifySupabaseServiceResponse,
} from "../app/lib/syncbay-supabase-service-health.ts";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 10_000;

const args = parseArgs(process.argv.slice(2));

await main().catch((error) => {
  console.error(`Diagnostica servizi Supabase non riuscita: ${formatError(error)}`);
  process.exit(1);
});

async function main() {
  const projectRef =
    args.projectRef ?? process.env.SUPABASE_PROJECT_REF ?? readLinkedProjectRef();

  if (!projectRef) {
    throw new Error(
      "Project ref Supabase non trovato. Usa --project-ref o collega il progetto con Supabase CLI.",
    );
  }

  const supabaseUrl = normalizeSupabaseUrl(
    args.supabaseUrl ?? process.env.SUPABASE_URL ?? `https://${projectRef}.supabase.co`,
  );
  // Separa subito etichetta e valore: `resolvedFrom` e' solo provenienza e
  // finisce nel report stampato, `apiKeyValue` resta confinato negli header.
  const { source: resolvedFrom, value: apiKeyValue } =
    await resolveSupabaseApiKey(projectRef);
  const headers = buildSupabaseServiceHeaders(apiKeyValue);
  const checks = await Promise.all(
    SUPABASE_HTTP_SERVICE_CHECKS.map((check) =>
      probeSupabaseService({ check, headers, supabaseUrl }),
    ),
  );
  const report = {
    ok: checks.every((check) => check.status === "healthy"),
    projectRef,
    resolvedFrom,
    services: checks,
    supabaseUrl,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  if (!report.ok) {
    process.exit(1);
  }
}

async function probeSupabaseService({ check, headers, supabaseUrl }) {
  const url = new URL(check.path, supabaseUrl);

  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(args.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const bodyText = await response.text();
    const diagnosis = classifySupabaseServiceResponse({
      allowRlsDenied: check.allowRlsDenied,
      bodyText,
      status: response.status,
    });

    return {
      id: check.id,
      label: check.label,
      message: diagnosis.message,
      path: check.path,
      reason: diagnosis.reason,
      status: diagnosis.status,
      statusCode: diagnosis.statusCode,
    };
  } catch (error) {
    return {
      id: check.id,
      label: check.label,
      message: formatError(error),
      path: check.path,
      reason: "network_error",
      status: "unhealthy",
      statusCode: 0,
    };
  }
}

async function resolveSupabaseApiKey(projectRef) {
  for (const envKey of [
    "SYNCBAY_SUPABASE_ANON_KEY",
    "SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
  ]) {
    const value = process.env[envKey]?.trim();

    if (value) {
      return { source: `env:${envKey}`, value };
    }
  }

  const { stdout } = await execFileAsync(
    "npx",
    [
      "supabase",
      "projects",
      "api-keys",
      "--project-ref",
      projectRef,
      "--output",
      "json",
    ],
    {
      env: {
        ...process.env,
        SUPABASE_TELEMETRY_DISABLED: "1",
      },
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
    },
  );
  const keyRows = parseApiKeyRows(stdout);
  const apiKeyRow =
    keyRows.find((row) => row.name === "anon") ??
    keyRows.find((row) => row.type === "publishable");
  const value = apiKeyRow?.api_key?.trim();

  if (!value) {
    throw new Error(
      "Anon/publishable key Supabase non trovata. Configura SUPABASE_ANON_KEY o SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  // Etichetta costante: non interpolare dati grezzi dallo stdout della CLI nel
  // report stampato, cosi' nessun output del provider finisce nei log.
  const source =
    apiKeyRow.name === "anon"
      ? "supabase-cli:anon"
      : "supabase-cli:publishable";

  return { source, value };
}

function parseApiKeyRows(stdout) {
  const jsonStart = findJsonStart(stdout);

  if (jsonStart < 0) {
    throw new Error("Supabase CLI non ha restituito JSON per le API key.");
  }

  const parsed = JSON.parse(stdout.slice(jsonStart));
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed.api_keys ??
      parsed.keys ??
      Object.values(parsed).find((value) => Array.isArray(value)) ??
      [];

  if (!Array.isArray(rows)) return [];

  return rows.filter((row) => row && typeof row === "object");
}

function findJsonStart(value) {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");

  if (objectStart < 0) return arrayStart;
  if (arrayStart < 0) return objectStart;

  return Math.min(objectStart, arrayStart);
}

function normalizeSupabaseUrl(rawUrl) {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");

  if (!trimmed) {
    throw new Error("SUPABASE_URL vuota.");
  }

  return trimmed;
}

function readLinkedProjectRef() {
  try {
    return fs.readFileSync("supabase/.temp/project-ref", "utf8").trim() || null;
  } catch {
    return null;
  }
}

function printReport(report) {
  console.log("SyncBay Supabase HTTP services");
  console.log(`- project: ${report.projectRef}`);
  console.log(`- url: ${report.supabaseUrl}`);
  console.log(`- API key: ${report.resolvedFrom} (valore non stampato)`);

  for (const service of report.services) {
    const reason = service.reason ? `, ${service.reason}` : "";
    console.log(
      `- ${service.label}: ${service.status} (HTTP ${service.statusCode}${reason})`,
    );

    if (service.message) {
      console.log(`  ${service.message}`);
    }
  }
}

function parseArgs(rawArgs) {
  const parsed = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--project-ref") {
      parsed.projectRef = readRequiredValue(rawArgs, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--supabase-url") {
      parsed.supabaseUrl = readRequiredValue(rawArgs, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--timeout-ms") {
      parsed.timeoutMs = parsePositiveInteger(readRequiredValue(rawArgs, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(`Uso: npm run supabase:services -- [--project-ref ref] [--supabase-url url] [--timeout-ms ms] [--json]

Verifica PostgREST, Auth e Storage via HTTP con apikey Supabase anon/publishable.
Non stampa chiavi o segreti. Serve a distinguere 401 da API key mancante e
restrizioni provider, per esempio 402 exceed_egress_quota.`);
      process.exit(0);
    }

    throw new Error(`Argomento non supportato: ${arg}`);
  }

  return parsed;
}

function readRequiredValue(rawArgs, index, flag) {
  const value = rawArgs[index + 1]?.trim();

  if (!value || value.startsWith("--")) {
    throw new Error(`Valore mancante per ${flag}.`);
  }

  return value;
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Valore numerico non valido: ${value}.`);
  }

  return parsed;
}

function formatError(error) {
  if (error instanceof Error) return error.message;

  return String(error);
}

#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MARKER = "[syncbay-loader-performance]";
const DEFAULT_DEPLOYMENT = "syncbay.vercel.app";
const DEFAULT_SINCE = "10m";
const ROUTE_ORDER = [
  "overview",
  "catalog",
  "import",
  "activity",
  "conflicts",
  "settings",
];

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const rawLogs = args.stdin ? readFileSync(0, "utf8") : readVercelLogs(args);
const records = parseLoaderPerformanceRecords(rawLogs);
const latestRecords = getLatestRecordsByRoute(records);

if (args.json) {
  console.log(
    JSON.stringify(
      {
        deployment: args.deployment,
        records: latestRecords,
        sampleCount: records.length,
        since: args.since,
      },
      null,
      2,
    ),
  );
} else {
  printReport({ args, latestRecords, sampleCount: records.length });
}

function parseArgs(rawArgs) {
  const parsed = {
    deployment: DEFAULT_DEPLOYMENT,
    help: false,
    json: false,
    since: DEFAULT_SINCE,
    stdin: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--stdin") {
      parsed.stdin = true;
      continue;
    }

    if (arg === "--since") {
      parsed.since = readOptionValue(rawArgs, index, "--since");
      index += 1;
      continue;
    }

    if (arg.startsWith("--since=")) {
      parsed.since = arg.slice("--since=".length);
      continue;
    }

    if (arg === "--deployment") {
      parsed.deployment = readOptionValue(rawArgs, index, "--deployment");
      index += 1;
      continue;
    }

    if (arg.startsWith("--deployment=")) {
      parsed.deployment = arg.slice("--deployment=".length);
      continue;
    }

    throw new Error(`Opzione non riconosciuta: ${arg}`);
  }

  return parsed;
}

function readOptionValue(rawArgs, index, optionName) {
  const value = rawArgs[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Valore mancante per ${optionName}`);
  }

  return value;
}

function readVercelLogs({ deployment, since }) {
  const result = spawnSync(
    "vercel",
    [
      "logs",
      deployment,
      "--since",
      since,
      "--query",
      "syncbay-loader-performance",
      "--json",
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const details = result.stderr.trim() || result.stdout.trim();
    throw new Error(`vercel logs fallito: ${details}`);
  }

  return result.stdout;
}

function parseLoaderPerformanceRecords(rawLogs) {
  const records = [];
  const lines = rawLogs.split(/\r?\n/);

  for (const [lineIndex, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line) continue;

    const parsedLine = parseJsonMaybe(line);
    const messages =
      parsedLine === null
        ? [{ message: line, observedAt: null }]
        : collectLogMessages(parsedLine);

    for (const item of messages) {
      const metric = extractMetricFromMessage(item.message);
      if (!metric) continue;

      records.push({
        details: metric.details ?? {},
        metrics: Array.isArray(metric.metrics) ? metric.metrics : [],
        observedAt: item.observedAt,
        observationIndex: lineIndex,
        payloadBytes: metric.payloadBytes ?? null,
        route: String(metric.route ?? "unknown"),
        runtime: metric.runtime ?? {},
        totalMs: Number(metric.totalMs),
      });
    }
  }

  return records.filter(
    (record) => record.route !== "unknown" && Number.isFinite(record.totalMs),
  );
}

function collectLogMessages(value, inheritedTimestamp = null) {
  if (typeof value === "string") {
    return [{ message: value, observedAt: inheritedTimestamp }];
  }

  if (!value || typeof value !== "object") return [];

  const ownTimestamp = getTimestamp(value) ?? inheritedTimestamp;

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectLogMessages(entry, ownTimestamp));
  }

  const messages = [];

  if (typeof value.message === "string") {
    messages.push({ message: value.message, observedAt: ownTimestamp });
  }

  if (Array.isArray(value.logs)) {
    messages.push(
      ...value.logs.flatMap((entry) => collectLogMessages(entry, ownTimestamp)),
    );
  }

  if (Array.isArray(value.entries)) {
    messages.push(
      ...value.entries.flatMap((entry) =>
        collectLogMessages(entry, ownTimestamp),
      ),
    );
  }

  return messages;
}

function getTimestamp(value) {
  if (!value || typeof value !== "object") return null;

  for (const key of ["timestamp", "created", "createdAt", "time", "date"]) {
    if (typeof value[key] === "string" || typeof value[key] === "number") {
      return value[key];
    }
  }

  return null;
}

function extractMetricFromMessage(message) {
  const markerIndex = message.indexOf(MARKER);
  if (markerIndex === -1) return null;

  const afterMarker = message.slice(markerIndex + MARKER.length).trim();
  const jsonStart = afterMarker.indexOf("{");
  if (jsonStart === -1) return null;

  return parseJsonMaybe(afterMarker.slice(jsonStart));
}

function parseJsonMaybe(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getLatestRecordsByRoute(records) {
  const latestByRoute = new Map();

  for (const record of records) {
    latestByRoute.set(record.route, record);
  }

  return [...latestByRoute.values()].sort(compareRoutes);
}

function compareRoutes(a, b) {
  const routeA = ROUTE_ORDER.indexOf(a.route);
  const routeB = ROUTE_ORDER.indexOf(b.route);

  if (routeA !== routeB) {
    return normalizeRouteIndex(routeA) - normalizeRouteIndex(routeB);
  }

  return a.route.localeCompare(b.route);
}

function normalizeRouteIndex(value) {
  return value === -1 ? Number.MAX_SAFE_INTEGER : value;
}

function printReport({ args, latestRecords, sampleCount }) {
  console.log(
    `Loader performance ${args.deployment} (ultimi ${args.since}, campioni ${sampleCount})`,
  );

  if (latestRecords.length === 0) {
    console.log(
      `Nessun log ${MARKER} trovato. Apri le route embedded e rilancia il comando.`,
    );
    return;
  }

  printTable(
    latestRecords.map((record) => {
      const slowestStage = getSlowestStage(record.metrics);

      return {
        bytes: formatNumber(record.payloadBytes),
        route: record.route,
        slowestStage: slowestStage
          ? `${slowestStage.label} ${formatMs(slowestStage.durationMs)}`
          : "-",
        totalMs: formatMs(record.totalMs),
        vercelRegion: record.runtime?.vercelRegion ?? "-",
      };
    }),
  );
}

function getSlowestStage(metrics) {
  return metrics.reduce((slowest, metric) => {
    if (!slowest || metric.durationMs > slowest.durationMs) return metric;
    return slowest;
  }, null);
}

function printTable(rows) {
  const columns = [
    ["route", "Route"],
    ["totalMs", "Totale"],
    ["vercelRegion", "Regione"],
    ["bytes", "Payload"],
    ["slowestStage", "Stage più lento"],
  ];
  const widths = columns.map(([key, header]) =>
    Math.max(header.length, ...rows.map((row) => String(row[key]).length)),
  );

  const header = columns
    .map(([, label], index) => label.padEnd(widths[index]))
    .join("  ");
  const separator = widths.map((width) => "-".repeat(width)).join("  ");

  console.log(header);
  console.log(separator);

  for (const row of rows) {
    console.log(
      columns
        .map(([key], index) => String(row[key]).padEnd(widths[index]))
        .join("  "),
    );
  }
}

function formatMs(value) {
  return `${Number(value).toFixed(1)} ms`;
}

function formatNumber(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat("it-IT").format(value) : "-";
}

function printHelp() {
  console.log(`Uso:
  npm run perf:loaders -- [--since 10m] [--deployment syncbay.vercel.app]
  vercel logs syncbay.vercel.app --since 10m --query syncbay-loader-performance --json | npm run perf:loaders -- --stdin

Opzioni:
  --since <durata>       Finestra log Vercel. Default: ${DEFAULT_SINCE}
  --deployment <target>  Deployment, dominio o URL Vercel. Default: ${DEFAULT_DEPLOYMENT}
  --stdin                Legge log da stdin invece di chiamare Vercel CLI
  --json                 Stampa JSON parsato
`);
}

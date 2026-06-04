#!/usr/bin/env node

import fs from "node:fs";
import { spawnSync } from "node:child_process";

const REQUIRED_ENV_KEYS = [
  "DATABASE_URL",
  "DATABASE_DIRECT_URL",
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SCOPES",
  "APP_URL",
  "APP_SECRET",
  "TOKEN_ENCRYPTION_KEY",
];

const args = parseArgs(process.argv.slice(2));
const report = buildReport();

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport(report);
}

if (report.failures.length > 0) {
  process.exit(1);
}

function buildReport() {
  const nodeVersion = process.versions.node;
  const npmVersion = runOptional("npm", ["--version"]);
  const nodePath = process.execPath;
  const npmPath = runOptional("which", ["npm"]);
  const expectedNodeVersion = readText(".node-version")?.trim() ?? null;
  const packageJson = readJson("package.json");
  const npmrc = readText(".npmrc") ?? "";
  const dotenvKeys = readDotEnvKeys(".env");
  const requiredEnv = REQUIRED_ENV_KEYS.map((key) => ({
    configured: Boolean(process.env[key]) || dotenvKeys.has(key),
    key,
  }));
  const failures = [];
  const warnings = [];

  if (!expectedNodeVersion) {
    failures.push(".node-version mancante.");
  } else if (!satisfiesNodeRange(nodeVersion, packageJson?.engines?.node)) {
    failures.push(
      `Node ${nodeVersion} non rispetta engines.node ${packageJson?.engines?.node ?? "non dichiarato"}.`,
    );
  } else if (majorVersion(nodeVersion) !== majorVersion(expectedNodeVersion)) {
    failures.push(
      `Node attivo ${nodeVersion} non è coerente con .node-version ${expectedNodeVersion}.`,
    );
  } else if (nodeVersion !== expectedNodeVersion) {
    warnings.push(
      `Node attivo ${nodeVersion} diverso dal pin .node-version ${expectedNodeVersion}.`,
    );
  }

  if (!npmVersion) {
    failures.push("npm non risolto nel PATH.");
  } else if (!satisfiesNpmRange(npmVersion, packageJson?.engines?.npm)) {
    failures.push(
      `npm ${npmVersion} non rispetta engines.npm ${packageJson?.engines?.npm ?? "non dichiarato"}.`,
    );
  } else {
    const packageManager = packageJson?.packageManager ?? "";
    const expectedNpm = packageManager.match(/^npm@(.+)$/)?.[1] ?? null;
    if (expectedNpm && npmVersion !== expectedNpm) {
      warnings.push(
        `npm attivo ${npmVersion} diverso da packageManager ${packageManager}; il range engines resta valido.`,
      );
    }
  }

  if (!/^\s*engine-strict\s*=\s*true\s*$/m.test(npmrc)) {
    failures.push(".npmrc deve mantenere engine-strict=true.");
  }

  if (!fs.existsSync("package-lock.json")) {
    failures.push("package-lock.json mancante.");
  }

  if (!fs.existsSync("prisma/schema.prisma")) {
    failures.push("prisma/schema.prisma mancante.");
  }

  const missingEnv = requiredEnv
    .filter((entry) => !entry.configured)
    .map((entry) => entry.key);

  if (missingEnv.length > 0) {
    const message = `Variabili locali non configurate in env/.env: ${missingEnv.join(", ")}.`;
    if (args.strictEnv) {
      failures.push(message);
    } else {
      warnings.push(message);
    }
  }

  return {
    checks: {
      dotenvPresent: fs.existsSync(".env"),
      engineStrict: /^\s*engine-strict\s*=\s*true\s*$/m.test(npmrc),
      nodePath,
      nodeVersion,
      npmPath,
      npmVersion,
      packageManager: packageJson?.packageManager ?? null,
      requiredEnv,
      strictEnv: Boolean(args.strictEnv),
      targetNodeVersion: expectedNodeVersion,
    },
    failures,
    ok: failures.length === 0,
    warnings,
  };
}

function printReport(currentReport) {
  console.log("Doctor locale SyncBay");
  console.log(
    `Node: ${currentReport.checks.nodeVersion} (${currentReport.checks.nodePath})`,
  );
  console.log(
    `npm: ${currentReport.checks.npmVersion ?? "non trovato"} (${currentReport.checks.npmPath ?? "PATH non trovato"})`,
  );
  console.log(`Target Node: ${currentReport.checks.targetNodeVersion ?? "n/d"}`);
  console.log(`.env presente: ${currentReport.checks.dotenvPresent ? "sì" : "no"}`);

  if (currentReport.failures.length > 0) {
    console.log("");
    console.log("Errori:");
    for (const failure of currentReport.failures) console.log(`- ${failure}`);
  }

  if (currentReport.warnings.length > 0) {
    console.log("");
    console.log("Avvisi:");
    for (const warning of currentReport.warnings) console.log(`- ${warning}`);
  }

  console.log("");
  console.log(
    currentReport.ok
      ? "Esito: ok. Gli avvisi non bloccano i check locali."
      : "Esito: non pronto. Correggi gli errori prima di usare il runtime locale.",
  );
}

function parseArgs(rawArgs) {
  const parsed = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--strict-env") {
      parsed.strictEnv = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(`Uso: npm run doctor:local -- [--strict-env] [--json]

Verifica toolchain locale, engine-strict, file base e presenza delle env SyncBay
senza stampare valori sensibili. Senza --strict-env le env mancanti sono avvisi,
perché alcuni check docs/runtime non richiedono database o provider live.`);
      process.exit(0);
    }

    throw new Error(`Argomento non supportato: ${arg}`);
  }

  return parsed;
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function readJson(filePath) {
  const source = readText(filePath);
  if (!source) return null;

  return JSON.parse(source);
}

function readDotEnvKeys(filePath) {
  const keys = new Set();
  const source = readText(filePath);
  if (!source) return keys;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    keys.add(line.slice(0, separatorIndex).trim());
  }

  return keys;
}

function runOptional(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0) return null;

  return result.stdout.trim();
}

function majorVersion(version) {
  return Number.parseInt(String(version).split(".")[0] ?? "", 10);
}

function satisfiesNodeRange(version, range) {
  if (!range) return true;

  const [major, minor] = parseVersionParts(version);
  if (range === ">=24.15 <25") {
    return major === 24 && minor >= 15;
  }

  return true;
}

function satisfiesNpmRange(version, range) {
  if (!range) return true;

  const [major] = parseVersionParts(version);
  if (range === ">=11 <12") {
    return major === 11;
  }

  return true;
}

function parseVersionParts(version) {
  return String(version)
    .split(".")
    .map((part) => Number.parseInt(part, 10));
}

#!/usr/bin/env node

import { parseArgs as parseNodeArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REQUIRED_ENV_GROUPS = [
  { key: "DATABASE_URL" },
  { key: "DATABASE_DIRECT_URL" },
  { key: "SHOPIFY_API_KEY" },
  { key: "SHOPIFY_API_SECRET" },
  { aliases: ["SCOPES"], key: "SHOPIFY_SCOPES" },
  { key: "SHOPIFY_APP_URL" },
  { key: "APP_SECRET" },
  { key: "TOKEN_ENCRYPTION_KEY" },
];

if (import.meta.main) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = buildReport({ args });

    if (args.json) console.log(JSON.stringify(report, null, 2));
    else printReport(report);

    process.exit(report.failures.length > 0 ? 1 : 0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export function buildReport({ args = {}, env = process.env, root = process.cwd() } = {}) {
  const nodeVersion = process.versions.node;
  const npmVersion = runOptional("npm", ["--version"]);
  const nodePath = process.execPath;
  const npmPath = runOptional("which", ["npm"]);
  const expectedNodeVersion = readText(root, ".node-version")?.trim() ?? null;
  const packageJson = readJson(root, "package.json");
  const packageLock = readJson(root, "package-lock.json");
  const installedLock = readJson(root, "node_modules/.package-lock.json");
  const npmrc = readText(root, ".npmrc") ?? "";
  const dotenvKeys = readDotEnvKeys(root, ".env");
  const requiredEnv = REQUIRED_ENV_GROUPS.map((group) => {
    const names = getEnvGroupNames(group);

    return {
      aliases: group.aliases ?? [],
      configured: names.some((key) => Boolean(env[key]) || dotenvKeys.has(key)),
      key: group.key,
    };
  });
  const failures = [];
  const warnings = [];
  const dependenciesInstalled = fs.existsSync(path.join(root, "node_modules"));
  const lockfileMismatches =
    packageLock && installedLock ? findTopLevelLockMismatches(packageLock, installedLock) : [];
  const lockfileAligned =
    dependenciesInstalled && Boolean(installedLock) && lockfileMismatches.length === 0;
  const prismaClient = inspectPrismaClient(root);

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

  if (!packageLock) {
    failures.push("package-lock.json mancante.");
  }

  if (!fs.existsSync(path.join(root, "prisma/schema.prisma"))) {
    failures.push("prisma/schema.prisma mancante.");
  }

  if (!dependenciesInstalled) {
    failures.push("Dipendenze locali mancanti: eseguire npm install.");
  } else if (!installedLock) {
    failures.push(
      "Installazione locale non verificabile rispetto al lockfile: eseguire npm install.",
    );
  } else if (lockfileMismatches.length > 0) {
    failures.push(
      `Dipendenze top-level non allineate a package-lock.json: ${lockfileMismatches.join(", ")}. Eseguire npm install.`,
    );
  }

  if (!prismaClient.generated) {
    failures.push("Prisma Client non generato: eseguire npm run prisma:generate.");
  } else if (!prismaClient.linked) {
    failures.push("Link Prisma Client non allineato: eseguire npm run prisma:generate.");
  }

  const missingEnv = requiredEnv.filter((entry) => !entry.configured).map(formatEnvRequirement);

  if (missingEnv.length > 0) {
    const message = `Variabili locali non configurate in env/.env: ${missingEnv.join(", ")}.`;
    if (args.strictEnv) failures.push(message);
    else warnings.push(message);
  }

  return {
    checks: {
      dependenciesInstalled,
      dotenvPresent: fs.existsSync(path.join(root, ".env")),
      engineStrict: /^\s*engine-strict\s*=\s*true\s*$/m.test(npmrc),
      lockfileAligned,
      lockfileMismatches,
      nodePath,
      nodeVersion,
      npmPath,
      npmVersion,
      packageManager: packageJson?.packageManager ?? null,
      prismaClientGenerated: prismaClient.generated,
      prismaClientLinked: prismaClient.linked,
      requiredEnv,
      strictEnv: Boolean(args.strictEnv),
      targetNodeVersion: expectedNodeVersion,
    },
    failures,
    ok: failures.length === 0,
    warnings,
  };
}

export function findTopLevelLockMismatches(rootLock, installedLock) {
  const rootPackages = rootLock?.packages ?? {};
  const installedPackages = installedLock?.packages ?? {};
  const rootManifest = rootPackages[""] ?? {};
  const dependencyNames = new Set([
    ...Object.keys(rootManifest.dependencies ?? {}),
    ...Object.keys(rootManifest.devDependencies ?? {}),
    ...Object.keys(rootManifest.optionalDependencies ?? {}),
  ]);
  const mismatches = [];

  for (const name of [...dependencyNames].sort()) {
    const packagePath = `node_modules/${name}`;
    const expectedVersion = rootPackages[packagePath]?.version ?? null;
    if (!expectedVersion) continue;
    const installedVersion = installedPackages[packagePath]?.version ?? null;
    if (installedVersion !== expectedVersion) {
      mismatches.push(
        `${name} (${installedVersion ? `installato ${installedVersion}` : "non installato"}, atteso ${expectedVersion})`,
      );
    }
  }

  return mismatches;
}

export function inspectPrismaClient(root) {
  const generatedDirectory = path.join(root, "prisma/generated/client");
  const generated = fs.existsSync(path.join(generatedDirectory, "index.js"));
  const linkPath = path.join(root, "node_modules/.prisma/client/default");
  let linked = false;

  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      const resolvedTarget = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
      linked = resolvedTarget === generatedDirectory;
    }
  } catch {
    linked = false;
  }

  return { generated, linked };
}

function printReport(report) {
  console.log("Doctor locale SyncBay");
  console.log(`Node: ${report.checks.nodeVersion} (${report.checks.nodePath})`);
  console.log(
    `npm: ${report.checks.npmVersion ?? "non trovato"} (${report.checks.npmPath ?? "PATH non trovato"})`,
  );
  console.log(`Target Node: ${report.checks.targetNodeVersion ?? "n/d"}`);
  console.log(`.env presente: ${report.checks.dotenvPresent ? "sì" : "no"}`);
  console.log(
    `Dipendenze/lockfile: ${report.checks.lockfileAligned ? "allineati" : "da riallineare"}`,
  );
  console.log(
    `Prisma Client: ${report.checks.prismaClientGenerated && report.checks.prismaClientLinked ? "pronto" : "da generare"}`,
  );

  if (report.failures.length > 0) {
    console.log("\nErrori:");
    for (const failure of report.failures) console.log(`- ${failure}`);
  }

  if (report.warnings.length > 0) {
    console.log("\nAvvisi:");
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }

  console.log("");
  console.log(
    report.ok
      ? "Esito: ok. Gli avvisi non bloccano i check locali."
      : "Esito: non pronto. Correggi gli errori prima di usare il runtime locale.",
  );
}

function parseArgs(rawArgs) {
  const { values } = parseNodeArgs({
    args: rawArgs,
    options: {
      help: { short: "h", type: "boolean" },
      json: { type: "boolean" },
      "strict-env": { type: "boolean" },
    },
  });

  if (values.help) {
    console.log(`Uso: npm run doctor:local -- [--strict-env] [--json]

Verifica toolchain locale, dipendenze/lockfile, Prisma Client, file base e
presenza delle env SyncBay senza stampare valori sensibili. Senza --strict-env
le env mancanti sono avvisi, perché alcuni check non richiedono provider live.`);
    process.exit(0);
  }

  return { json: values.json, strictEnv: values["strict-env"] };
}

function readText(root, filePath) {
  try {
    return fs.readFileSync(path.join(root, filePath), "utf8");
  } catch {
    return null;
  }
}

function readJson(root, filePath) {
  const source = readText(root, filePath);
  if (!source) return null;

  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function readDotEnvKeys(root, filePath) {
  const keys = new Set();
  const source = readText(root, filePath);
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

function getEnvGroupNames(group) {
  return [group.key, ...(group.aliases ?? [])];
}

function formatEnvRequirement(entry) {
  if (entry.aliases.length === 0) return entry.key;
  return `${entry.key} (fallback: ${entry.aliases.join(", ")})`;
}

function runOptional(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function majorVersion(version) {
  return Number.parseInt(String(version).split(".")[0] ?? "", 10);
}

function satisfiesNodeRange(version, range) {
  if (!range) return true;
  const [major, minor] = parseVersionParts(version);
  if (range === ">=24.15 <25") return major === 24 && minor >= 15;
  return true;
}

function satisfiesNpmRange(version, range) {
  if (!range) return true;
  const [major] = parseVersionParts(version);
  if (range === ">=11 <12") return major === 11;
  return true;
}

function parseVersionParts(version) {
  return String(version)
    .split(".")
    .map((part) => Number.parseInt(part, 10));
}

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function parseBackupArgs(args) {
  const apply = args.includes("--apply");
  const confirmed = args.includes("--confirm-apply");
  const restoreCheck = args.includes("--restore-check");
  if (apply !== confirmed) throw new Error("L'export richiede insieme --apply e --confirm-apply.");
  return { apply, restoreCheck };
}

export function assertNonProductionTarget(url) {
  if (!url || /(?:prod|production|supabase\.co)/iu.test(url)) throw new Error("Il restore-check richiede un target esplicitamente non-production.");
}

export function checksum(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function extractPostgresMajor(value) {
  const match = String(value ?? "").match(/(?:PostgreSQL\)?\s+)?(\d+)(?:\.\d+)?/iu);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function assertCompatiblePostgresVersions(backupVersion, targetVersion) {
  const backupMajor = extractPostgresMajor(backupVersion);
  const targetMajor = extractPostgresMajor(targetVersion);
  if (!backupMajor || !targetMajor) throw new Error("Versione PostgreSQL non verificabile.");
  if (backupMajor !== targetMajor) {
    throw new Error(`Versioni PostgreSQL incompatibili: backup ${backupMajor}, target ${targetMajor}.`);
  }
}

function postgresEnv(connectionUrl) {
  const parsed = new URL(connectionUrl);
  return {
    database: decodeURIComponent(parsed.pathname.replace(/^\//u, "")),
    env: {
      ...process.env,
      PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//u, "")),
      PGHOST: parsed.hostname,
      PGPASSWORD: decodeURIComponent(parsed.password),
      PGPORT: parsed.port || "5432",
      PGUSER: decodeURIComponent(parsed.username),
    },
  };
}

export function runBackup(args = process.argv.slice(2)) {
  const options = parseBackupArgs(args);
  if (!options.apply && !options.restoreCheck) {
    console.log("Dry-run: export logico cifrato; nessun dato letto o scritto. Usa --apply --confirm-apply.");
    return;
  }
  if (options.restoreCheck) {
    const target = process.env.SYNCBAY_RESTORE_DATABASE_URL;
    assertNonProductionTarget(target);
    const targetConnection = postgresEnv(target);
    const archive = args.find((arg) => arg.startsWith("--archive="))?.slice(10);
    if (!archive) {
      console.log("Restore-check dry-run autorizzato su target non-production; specificare --archive=<file> per verificare manifest, checksum e versioni.");
      return;
    }
    const manifestPath = `${archive}.manifest.json`;
    if (!fs.existsSync(archive) || !fs.existsSync(manifestPath)) throw new Error("Archivio o manifest mancante.");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.sha256 !== checksum(archive)) throw new Error("Checksum archivio non valido.");
    const schemaPath = path.resolve("prisma/schema.prisma");
    if (manifest.prismaSchemaSha256 !== checksum(schemaPath)) throw new Error("Versione schema Prisma diversa dal backup.");
    const decrypted = spawnSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-pass", "env:SYNCBAY_BACKUP_PASSPHRASE", "-in", archive], { env: process.env, encoding: null, maxBuffer: 1024 * 1024 * 1024 });
    if (decrypted.status !== 0) throw new Error("Decifratura archivio non completata.");
    const list = spawnSync("pg_restore", ["--list"], { input: decrypted.stdout, encoding: null, maxBuffer: 16 * 1024 * 1024 });
    if (list.status !== 0) throw new Error("Archivio pg_restore non valido.");
    const targetVersion = spawnSync("psql", ["--tuples-only", "--command=SHOW server_version"], { encoding: "utf8", env: targetConnection.env });
    if (targetVersion.status !== 0 || !targetVersion.stdout.trim()) throw new Error("Versione PostgreSQL target non verificabile.");
    assertCompatiblePostgresVersions(manifest.pgDumpVersion, targetVersion.stdout);
    if (options.apply) {
      const restore = spawnSync("pg_restore", ["--clean", "--if-exists", "--no-owner", `--dbname=${targetConnection.database}`], { input: decrypted.stdout, encoding: null, env: targetConnection.env, maxBuffer: 16 * 1024 * 1024 });
      if (restore.status !== 0) throw new Error("Restore non-production non completato.");
    }
    console.log(options.apply ? "Restore non-production completato e verificato; nessun dato stampato." : "Archivio, checksum e versioni verificati; nessuna scrittura eseguita.");
    return;
  }
  const outputDir = process.env.SYNCBAY_BACKUP_OUTPUT_DIR;
  const passphrase = process.env.SYNCBAY_BACKUP_PASSPHRASE;
  if (!outputDir || !passphrase || !process.env.DATABASE_DIRECT_URL) throw new Error("Mancano destinazione offsite, passphrase o DATABASE_DIRECT_URL.");
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const archive = path.join(outputDir, `syncbay-${stamp}.dump.enc`);
  const sourceConnection = postgresEnv(process.env.DATABASE_DIRECT_URL);
  const pgDumpVersionResult = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
  const pgDumpVersion = pgDumpVersionResult.stdout?.trim();
  if (pgDumpVersionResult.status !== 0 || !extractPostgresMajor(pgDumpVersion)) {
    throw new Error("Versione pg_dump non verificabile.");
  }
  const dump = spawnSync("pg_dump", ["--format=custom", "--no-owner", "--schema=public"], { encoding: null, env: sourceConnection.env, maxBuffer: 1024 * 1024 * 1024 });
  if (dump.status !== 0) throw new Error("pg_dump non completato.");
  const encrypted = spawnSync("openssl", ["enc", "-aes-256-cbc", "-pbkdf2", "-salt", "-pass", "env:SYNCBAY_BACKUP_PASSPHRASE", "-out", archive], { input: dump.stdout, env: process.env, encoding: null });
  if (encrypted.status !== 0) {
    fs.rmSync(archive, { force: true });
    throw new Error("Cifratura backup non completata.");
  }
  const manifest = { archive: path.basename(archive), createdAt: new Date().toISOString(), format: "pg_dump-custom+aes-256-cbc", pgDumpVersion, prismaSchemaSha256: checksum(path.resolve("prisma/schema.prisma")), sha256: checksum(archive) };
  fs.writeFileSync(`${archive}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(`Backup cifrato creato: ${path.basename(archive)}; nessun dato stampato.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runBackup();

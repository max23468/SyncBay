#!/usr/bin/env node

import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

import { encryptSecretIfNeeded } from "../app/services/crypto.server.ts";
import { isEncryptedSecretEnvelope } from "../app/lib/syncbay-secret-envelope.ts";
import { getSupabaseCliEnv } from "./supabase-cli-env.mjs";
import { selectTokenEncryptionKey } from "./syncbay-token-key-source.mjs";

const execFileAsync = promisify(execFile);
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const confirmed = args.has("--confirm-apply");

if (apply !== confirmed) {
  throw new Error("La scrittura richiede insieme --apply e --confirm-apply.");
}

const selectedKey = selectTokenEncryptionKey({
  envValue: process.env.TOKEN_ENCRYPTION_KEY,
  keychainValue: readKeychainSecret("syncbay-token-encryption-key"),
});
if (!selectedKey.value) {
  throw new Error("Chiave di cifratura token non disponibile.");
}
process.env.TOKEN_ENCRYPTION_KEY = selectedKey.value;

const sessions = await queryRows(
  `select id, "accessToken", "refreshToken" from "Session" order by id;`,
);
const summary = {
  scanned: sessions.length,
  plaintextAccessTokens: 0,
  plaintextRefreshTokens: 0,
  updated: 0,
  failed: 0,
};

for (const session of sessions) {
  const accessNeedsEncryption = Boolean(
    session.accessToken && !isEncryptedSecretEnvelope(session.accessToken),
  );
  const refreshNeedsEncryption = Boolean(
    session.refreshToken && !isEncryptedSecretEnvelope(session.refreshToken),
  );
  if (accessNeedsEncryption) summary.plaintextAccessTokens += 1;
  if (refreshNeedsEncryption) summary.plaintextRefreshTokens += 1;
  if (!apply || (!accessNeedsEncryption && !refreshNeedsEncryption)) continue;

  try {
    const accessToken = encryptSecretIfNeeded(session.accessToken ?? "");
    const refreshToken = session.refreshToken
      ? encryptSecretIfNeeded(session.refreshToken)
      : null;
    await queryRows(
      `update "Session" set "accessToken" = ${sqlString(accessToken)}, ` +
        `"refreshToken" = ${refreshToken ? sqlString(refreshToken) : "null"} ` +
        `where id = ${sqlString(session.id)} returning id;`,
    );
    summary.updated += 1;
  } catch {
    summary.failed += 1;
  }
}

console.log(JSON.stringify(summary));
if (summary.failed > 0) process.exitCode = 1;

async function queryRows(sql) {
  const { stdout } = await execFileAsync(
    "npx",
    ["supabase", "db", "query", "--linked", "--output", "json", sql],
    {
      env: await getSupabaseCliEnv(),
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
    },
  );
  const start = Math.min(
    ...[stdout.indexOf("{"), stdout.indexOf("[")].filter((index) => index >= 0),
  );
  if (!Number.isFinite(start)) throw new Error("Supabase CLI non ha restituito JSON.");
  const parsed = JSON.parse(stdout.slice(start));
  return parsed.rows ?? parsed;
}

function readKeychainSecret(service) {
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-w", "-s", service],
      { encoding: "utf8" },
    );
  } catch {
    return null;
  }
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

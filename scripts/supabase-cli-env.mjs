import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SUPABASE_DB_PASSWORD_KEYCHAIN_SERVICE = "syncbay-supabase-db-password";
const SUPABASE_DB_PASSWORD_KEYCHAIN_ACCOUNT = "SyncBay";

let cachedEnvPromise;

export async function getSupabaseCliEnv() {
  if (!cachedEnvPromise) {
    cachedEnvPromise = buildSupabaseCliEnv();
  }

  return cachedEnvPromise;
}

// Esegue una query SQL con la CLI Supabase linked e restituisce `{ rows }`.
// Prima viveva copiata, con piccole varianti, in ogni script di manutenzione.
export async function querySupabaseJson(sql, options = {}) {
  const { stdout } = await execFileAsync(
    "npx",
    ["supabase", "db", "query", "--linked", "--output", "json", sql],
    {
      cwd: options.cwd ?? getSupabaseCliCwd(),
      env: await getSupabaseCliEnv(),
      maxBuffer: 20 * 1024 * 1024,
      timeout: options.timeoutMs ?? 90_000,
    },
  );
  const jsonStart = findJsonStart(stdout);

  if (jsonStart < 0) {
    throw new Error("Supabase CLI non ha restituito JSON.");
  }

  const parsed = JSON.parse(stdout.slice(jsonStart));

  return Array.isArray(parsed) ? { rows: parsed } : parsed;
}

export function findJsonStart(value) {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");

  if (objectStart < 0) return arrayStart;
  if (arrayStart < 0) return objectStart;

  return Math.min(objectStart, arrayStart);
}

export function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function sqlQuote(value) {
  if (value == null) return "null";

  return sqlString(value);
}

export function sanitizeErrorText(value) {
  return String(value)
    .replaceAll(/\nwith [\s\S]*/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

export function formatCliError(error) {
  const stderr = typeof error?.stderr === "string" ? sanitizeErrorText(error.stderr) : "";
  const message = sanitizeErrorText(error?.message ?? String(error));
  const useful = stderr || message;

  if (useful.includes("ECIRCUITBREAKER")) {
    return "Supabase ha bloccato temporaneamente nuove connessioni per troppi tentativi di autenticazione. Attendi qualche minuto e riprova.";
  }

  if (error?.signal === "SIGTERM") {
    return "timeout durante la query Supabase. Riprova tra poco o riduci il carico di query concorrenti.";
  }

  return useful.split("\n").filter(Boolean).slice(0, 3).join(" ");
}

export function getSupabaseCliCwd(
  env = process.env,
  fallbackCwd = process.cwd(),
  { exists = existsSync, runGitWorktreeList = defaultRunGitWorktreeList } = {},
) {
  if (env.SYNCBAY_SUPABASE_CWD) return env.SYNCBAY_SUPABASE_CWD;
  if (hasSupabaseProjectRef(fallbackCwd, exists)) return fallbackCwd;

  return findLinkedSupabaseWorktree({ exists, runGitWorktreeList }) ?? fallbackCwd;
}

async function buildSupabaseCliEnv() {
  const baseEnv = withSupabaseCliDefaults(process.env);

  if (process.env.SUPABASE_DB_PASSWORD) {
    return baseEnv;
  }

  const password = await readSupabaseDbPasswordFromKeychain();

  if (!password) {
    return baseEnv;
  }

  return {
    ...baseEnv,
    SUPABASE_DB_PASSWORD: password,
  };
}

export function withSupabaseCliDefaults(env) {
  return {
    ...env,
    SUPABASE_TELEMETRY_DISABLED: env.SUPABASE_TELEMETRY_DISABLED ?? "1",
  };
}

async function readSupabaseDbPasswordFromKeychain() {
  if (process.platform !== "darwin") return null;

  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      SUPABASE_DB_PASSWORD_KEYCHAIN_SERVICE,
      "-a",
      SUPABASE_DB_PASSWORD_KEYCHAIN_ACCOUNT,
      "-w",
    ]);

    return stdout.replace(/\r?\n$/, "");
  } catch {
    return null;
  }
}

function findLinkedSupabaseWorktree({ exists, runGitWorktreeList }) {
  const output = runGitWorktreeList();

  if (!output) return null;

  for (const line of output.split("\n")) {
    if (!line.startsWith("worktree ")) continue;

    const worktreePath = line.slice("worktree ".length);

    if (hasSupabaseProjectRef(worktreePath, exists)) {
      return worktreePath;
    }
  }

  return null;
}

function hasSupabaseProjectRef(cwd, exists) {
  return exists(resolve(cwd, "supabase", ".temp", "project-ref"));
}

function defaultRunGitWorktreeList() {
  const result = spawnSync("git", ["worktree", "list", "--porcelain"], {
    encoding: "utf8",
  });

  if (result.status !== 0) return null;

  return result.stdout;
}

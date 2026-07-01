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

export function getSupabaseCliCwd(
  env = process.env,
  fallbackCwd = process.cwd(),
  {
    exists = existsSync,
    runGitWorktreeList = defaultRunGitWorktreeList,
  } = {},
) {
  if (env.SYNCBAY_SUPABASE_CWD) return env.SYNCBAY_SUPABASE_CWD;
  if (hasSupabaseProjectRef(fallbackCwd, exists)) return fallbackCwd;

  return findLinkedSupabaseWorktree({ exists, runGitWorktreeList }) ?? fallbackCwd;
}

async function buildSupabaseCliEnv() {
  if (process.env.SUPABASE_DB_PASSWORD) {
    return process.env;
  }

  const password = await readSupabaseDbPasswordFromKeychain();

  if (!password) {
    return process.env;
  }

  return {
    ...process.env,
    SUPABASE_DB_PASSWORD: password,
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

import { execFile } from "node:child_process";
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

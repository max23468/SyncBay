const SAFE_ENV_KEYS = [
  "CI",
  "FORCE_COLOR",
  "HOME",
  "LANG",
  "LC_ALL",
  "NO_COLOR",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
];

const RUNTIME_ENV_PATTERN =
  /^(APP_SECRET|DATABASE_|DIRECT_URL|EBAY_|PRISMA_|SCOPES$|SHOPIFY_|SUPABASE_|TOKEN_ENCRYPTION_KEY|VERCEL_)/;

export function buildIsolatedUiEnv(source = process.env) {
  const isolated = Object.fromEntries(
    SAFE_ENV_KEYS.flatMap((key) =>
      source[key] === undefined ? [] : [[key, source[key]]],
    ),
  );

  return {
    ...isolated,
    NODE_ENV: "test",
    SYNCBAY_UI_RENDER_FIXTURE: "1",
  };
}

export function scrubRuntimeEnv(target = process.env) {
  for (const key of Object.keys(target)) {
    if (RUNTIME_ENV_PATTERN.test(key)) delete target[key];
  }

  target.NODE_ENV = "test";
  target.SYNCBAY_UI_RENDER_FIXTURE = "1";
}

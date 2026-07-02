const DEFAULT_PRISMA_CONNECTION_LIMIT = "1";
const DEFAULT_PRISMA_POOL_TIMEOUT = "10";
const DEFAULT_DATABASE_URL = "postgresql://user:pass@localhost:5432/syncbay";
const LIBPQ_COMPAT_PARAM = "uselibpqcompat";
const SSL_MODE_PARAM = "sslmode";

export type PrismaRuntimePoolConfig = {
  connectionString: string;
  max: number;
  connectionTimeoutMillis: number;
};

export function buildPrismaRuntimeDatabaseUrl(databaseUrl?: string) {
  if (databaseUrl === undefined || databaseUrl === "") return databaseUrl;

  try {
    const url = new URL(databaseUrl);

    if (!["postgresql:", "postgres:"].includes(url.protocol) || !url.host) {
      return databaseUrl;
    }

    if (
      url.searchParams.get(SSL_MODE_PARAM)?.toLowerCase() === "require" &&
      !url.searchParams.has(LIBPQ_COMPAT_PARAM)
    ) {
      url.searchParams.set(LIBPQ_COMPAT_PARAM, "true");
    }

    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set(
        "connection_limit",
        DEFAULT_PRISMA_CONNECTION_LIMIT,
      );
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", DEFAULT_PRISMA_POOL_TIMEOUT);
    }

    return url.toString();
  } catch {
    return databaseUrl;
  }
}

export function buildPrismaRuntimePoolConfig(
  databaseUrl?: string,
): PrismaRuntimePoolConfig {
  const runtimeDatabaseUrl =
    buildPrismaRuntimeDatabaseUrl(databaseUrl || DEFAULT_DATABASE_URL) ||
    DEFAULT_DATABASE_URL;

  try {
    const url = new URL(runtimeDatabaseUrl);
    const max = getPositiveIntegerParam(
      url,
      "connection_limit",
      Number(DEFAULT_PRISMA_CONNECTION_LIMIT),
    );
    const poolTimeoutSeconds = getPositiveIntegerParam(
      url,
      "pool_timeout",
      Number(DEFAULT_PRISMA_POOL_TIMEOUT),
    );

    url.searchParams.delete("connection_limit");
    url.searchParams.delete("pool_timeout");

    return {
      connectionString: url.toString(),
      max,
      connectionTimeoutMillis: poolTimeoutSeconds * 1000,
    };
  } catch {
    return {
      connectionString: runtimeDatabaseUrl,
      max: Number(DEFAULT_PRISMA_CONNECTION_LIMIT),
      connectionTimeoutMillis: Number(DEFAULT_PRISMA_POOL_TIMEOUT) * 1000,
    };
  }
}

function getPositiveIntegerParam(
  url: URL,
  paramName: string,
  fallback: number,
) {
  const value = Number(url.searchParams.get(paramName));

  return Number.isInteger(value) && value > 0 ? value : fallback;
}

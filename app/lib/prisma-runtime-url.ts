const DEFAULT_PRISMA_CONNECTION_LIMIT = "1";
const DEFAULT_PRISMA_POOL_TIMEOUT = "10";

export function buildPrismaRuntimeDatabaseUrl(databaseUrl?: string) {
  if (databaseUrl === undefined || databaseUrl === "") return databaseUrl;

  try {
    const url = new URL(databaseUrl);

    if (!["postgresql:", "postgres:"].includes(url.protocol) || !url.host) {
      return databaseUrl;
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

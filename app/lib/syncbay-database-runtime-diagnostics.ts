export type DatabaseUrlHostKind =
  | "supabase_pooler"
  | "supabase_direct"
  | "vercel_postgres"
  | "other"
  | "unknown";

export type DatabaseUrlDiagnostics = {
  present: boolean;
  parseable: boolean;
  protocol: "postgresql" | "postgres" | "other" | "unknown";
  hostKind: DatabaseUrlHostKind;
  port: "5432" | "6543" | "default" | "other" | "unknown";
  databasePresent: boolean;
  hasPassword: boolean;
  params: string[];
  prismaPoolParams: {
    connectionLimit: boolean;
    poolTimeout: boolean;
  };
};

export type DatabaseRuntimeDiagnostics = {
  databaseUrl: DatabaseUrlDiagnostics;
  databaseDirectUrl: DatabaseUrlDiagnostics;
  postgresPrismaUrl: DatabaseUrlDiagnostics;
  postgresUrlNonPooling: DatabaseUrlDiagnostics;
  prismaRuntimeDatabaseUrl: DatabaseUrlDiagnostics;
  runtimeAppliedDefaults: {
    connectionLimit: boolean;
    poolTimeout: boolean;
  };
};

export function buildDatabaseRuntimeDiagnostics(input: {
  databaseUrl?: string;
  databaseDirectUrl?: string;
  postgresPrismaUrl?: string;
  postgresUrlNonPooling?: string;
  prismaRuntimeDatabaseUrl?: string;
}): DatabaseRuntimeDiagnostics {
  const databaseUrl = classifyDatabaseUrl(input.databaseUrl);
  const prismaRuntimeDatabaseUrl = classifyDatabaseUrl(input.prismaRuntimeDatabaseUrl);

  return {
    databaseUrl,
    databaseDirectUrl: classifyDatabaseUrl(input.databaseDirectUrl),
    postgresPrismaUrl: classifyDatabaseUrl(input.postgresPrismaUrl),
    postgresUrlNonPooling: classifyDatabaseUrl(input.postgresUrlNonPooling),
    prismaRuntimeDatabaseUrl,
    runtimeAppliedDefaults: {
      connectionLimit:
        !databaseUrl.prismaPoolParams.connectionLimit &&
        prismaRuntimeDatabaseUrl.prismaPoolParams.connectionLimit,
      poolTimeout:
        !databaseUrl.prismaPoolParams.poolTimeout &&
        prismaRuntimeDatabaseUrl.prismaPoolParams.poolTimeout,
    },
  };
}

export function classifyDatabaseUrl(rawUrl: string | undefined): DatabaseUrlDiagnostics {
  if (!rawUrl) return emptyDatabaseUrlDiagnostics(false);

  try {
    const url = new URL(rawUrl);
    const protocol = getProtocol(url.protocol);
    const params = [...url.searchParams.keys()].sort();

    return {
      present: true,
      parseable: true,
      protocol,
      hostKind: classifyHost(url.hostname),
      port: classifyPort(url.port),
      databasePresent: url.pathname.replace(/^\/+/, "").length > 0,
      hasPassword: url.password.length > 0,
      params,
      prismaPoolParams: {
        connectionLimit: url.searchParams.has("connection_limit"),
        poolTimeout: url.searchParams.has("pool_timeout"),
      },
    };
  } catch {
    return {
      ...emptyDatabaseUrlDiagnostics(true),
      parseable: false,
    };
  }
}

function emptyDatabaseUrlDiagnostics(present: boolean): DatabaseUrlDiagnostics {
  return {
    present,
    parseable: false,
    protocol: "unknown",
    hostKind: "unknown",
    port: "unknown",
    databasePresent: false,
    hasPassword: false,
    params: [],
    prismaPoolParams: {
      connectionLimit: false,
      poolTimeout: false,
    },
  };
}

function getProtocol(protocol: string): DatabaseUrlDiagnostics["protocol"] {
  if (protocol === "postgresql:") return "postgresql";
  if (protocol === "postgres:") return "postgres";
  return "other";
}

function classifyHost(hostname: string): DatabaseUrlHostKind {
  if (/pooler\.supabase\.com$/i.test(hostname) || /supavisor/i.test(hostname)) {
    return "supabase_pooler";
  }

  if (/^db\.[a-z0-9-]+\.supabase\.co$/i.test(hostname)) {
    return "supabase_direct";
  }

  if (/postgres(?:ql)?\.[a-z0-9.-]*vercel-storage\.com$/i.test(hostname)) {
    return "vercel_postgres";
  }

  return hostname ? "other" : "unknown";
}

function classifyPort(port: string): DatabaseUrlDiagnostics["port"] {
  if (!port) return "default";
  if (port === "5432") return "5432";
  if (port === "6543") return "6543";
  return "other";
}

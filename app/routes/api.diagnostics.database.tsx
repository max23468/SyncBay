import type { LoaderFunctionArgs } from "react-router";

import { buildDatabaseRuntimeDiagnostics } from "../lib/syncbay-database-runtime-diagnostics";
import { requireInternalAppSecret } from "../lib/syncbay-internal-auth";
import { buildPrismaRuntimeDatabaseUrl } from "../lib/prisma-runtime-url";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  requireInternalAppSecret(request, process.env.APP_SECRET);

  return Response.json({
    ok: true,
    endpoint: "syncbay-database-runtime-diagnostics",
    runtime: {
      nodeEnv: process.env.NODE_ENV ?? null,
      vercelRegion: process.env.VERCEL_REGION ?? null,
    },
    database: buildDatabaseRuntimeDiagnostics({
      databaseUrl: process.env.DATABASE_URL,
      databaseDirectUrl: process.env.DATABASE_DIRECT_URL,
      postgresPrismaUrl: process.env.POSTGRES_PRISMA_URL,
      postgresUrlNonPooling: process.env.POSTGRES_URL_NON_POOLING,
      prismaRuntimeDatabaseUrl: buildPrismaRuntimeDatabaseUrl(process.env.DATABASE_URL),
    }),
  });
};

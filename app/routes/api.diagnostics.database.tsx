import type { LoaderFunctionArgs } from "react-router";

import { buildDatabaseRuntimeDiagnostics } from "../lib/syncbay-database-runtime-diagnostics";
import { verifyInternalAppSecret } from "../lib/syncbay-internal-auth";
import { buildPrismaRuntimeDatabaseUrl } from "../lib/prisma-runtime-url";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  requireInternalAppSecret(request);

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
      prismaRuntimeDatabaseUrl: buildPrismaRuntimeDatabaseUrl(
        process.env.DATABASE_URL,
      ),
    }),
  });
};

function requireInternalAppSecret(request: Request) {
  const result = verifyInternalAppSecret({
    authorization: request.headers.get("authorization"),
    expectedSecret: process.env.APP_SECRET,
    headerSecret: request.headers.get("x-syncbay-app-secret"),
  });

  if (!result.ok) {
    throw new Response(result.message, { status: result.status });
  }
}

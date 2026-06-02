import { PrismaClient } from "@prisma/client";

import { buildPrismaRuntimeDatabaseUrl } from "./lib/prisma-runtime-url";

declare global {
  var prismaGlobal: PrismaClient;
}

const runtimeDatabaseUrl = buildPrismaRuntimeDatabaseUrl(
  process.env.DATABASE_URL,
);
const prismaClientOptions = runtimeDatabaseUrl
  ? {
      datasources: {
        db: {
          url: runtimeDatabaseUrl,
        },
      },
    }
  : undefined;

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient(prismaClientOptions);
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient(prismaClientOptions);

export default prisma;

import "dotenv/config";

import { defineConfig } from "prisma/config";

const FALLBACK_DATABASE_URL = "postgresql://user:pass@localhost:5432/syncbay";
const databaseUrl =
  firstPresentEnvValue(process.env.DATABASE_DIRECT_URL, process.env.DATABASE_URL) ??
  FALLBACK_DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});

function firstPresentEnvValue(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim());
}

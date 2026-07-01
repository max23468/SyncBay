import "dotenv/config";

import { defineConfig } from "prisma/config";

const FALLBACK_DATABASE_URL = "postgresql://user:pass@localhost:5432/syncbay";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url:
      process.env.DATABASE_DIRECT_URL ??
      process.env.DATABASE_URL ??
      FALLBACK_DATABASE_URL,
  },
});

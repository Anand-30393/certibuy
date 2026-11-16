// Prisma CLI configuration. Secrets come from the repo's .env.local (never committed).
// Migrations use the direct (session) connection; the app uses the pooled DATABASE_URL at runtime.
import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile(new URL("../../.env.local", import.meta.url));
} catch {
  // CI and other environments provide variables directly.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // `prisma generate` never connects, so CI can run it without credentials.
  datasource: {
    url:
      process.env.DIRECT_URL ??
      process.env.DATABASE_URL ??
      "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});

// @certibuy/db — Prisma client for CertiBuy (portable PostgreSQL).
// Runtime uses the pooled DATABASE_URL (Supabase transaction pooler) through the pg adapter.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export * from "./generated/prisma/client";
export type { PrismaClient };

/** Prisma's `pgbouncer=true` flag is meaningless to node-postgres; drop it before connecting. */
function runtimeUrl(raw: string): string {
  const url = new URL(raw);
  url.searchParams.delete("pgbouncer");
  return url.toString();
}

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  // Supabase requires TLS; its pooler certificate chain is not in Node's default store.
  const adapter = new PrismaPg({
    connectionString: runtimeUrl(connectionString),
    ssl: { rejectUnauthorized: false },
  });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { __certibuyPrisma?: PrismaClient };

/** One client per server process (survives Next.js dev hot reloads). Created on first use. */
export function getPrisma(): PrismaClient {
  globalForPrisma.__certibuyPrisma ??= createPrismaClient();
  return globalForPrisma.__certibuyPrisma;
}

/** A `@db.Date` value (UTC midnight) → yyyy-mm-dd business day. */
export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** yyyy-mm-dd business day → the Date Prisma stores in a `@db.Date` column. */
export function fromIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

# ADR 0002 — Prisma for data access, not the Supabase JS client

**Status:** Accepted · **Date:** 14 November 2026

## Context

Money and status commands must run inside database transactions with row locks and advisory locks (for example: two buyers for one listing, hub slot capacity, Instant Cash caps). The schema must stay portable PostgreSQL.

## Decision

- All application data access goes through Prisma from server code.
- Runtime uses Supabase's pooled connection (transaction mode, `pgbouncer=true`); migrations use the direct connection.
- Only transaction-scoped locks are used (`pg_advisory_xact_lock`, `SELECT … FOR UPDATE`).
- RLS policies are written against `app.current_user_id()`, a shim defined in Supabase-only SQL, so the policies stay portable.
- The browser never queries tables directly; the Supabase client is used only for Auth and Storage, inside `packages/integrations/src/supabase`.

## Consequences

- Transactions, locks and partial unique indexes are available for every money path.
- Prisma bypasses RLS, so authorisation is enforced in application policies and scoped repository helpers; RLS remains the last line of defence for any direct access.

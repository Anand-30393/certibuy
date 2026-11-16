# @certibuy/db

Prisma schema, migrations, Supabase-only SQL and seeds for CertiBuy (`docs/architecture.md` §7).

| Path | Contents |
| --- | --- |
| `prisma/schema.prisma` | 21 domain tables + infrastructure tables (portable PostgreSQL) |
| `prisma/migrations/` | `init` (generated) and `constraints_ledgers_rls` (partial unique indexes, value checks, append-only ledger triggers, RLS policies via `app.current_user_id()`) |
| `supabase/001_supabase.sql` | Supabase-only: `current_user_id()` = `auth.uid()`, profile bootstrap trigger, schema grants, storage buckets. Idempotent |
| `seed/seed.ts` | Settings (golden defaults), 3 hubs, 6 starter models (placeholder prices), demo accounts per role |
| `src/index.ts` | `getPrisma()` (pooled connection, pg adapter), date helpers |

Commands (credentials come from the repo-root `.env.local`; never commit it):

```bash
corepack pnpm --filter @certibuy/db generate         # Prisma client (also runs on install)
corepack pnpm --filter @certibuy/db migrate:deploy   # apply migrations (direct/session connection)
corepack pnpm --filter @certibuy/db supabase:apply   # Supabase-only SQL (safe to re-run)
corepack pnpm --filter @certibuy/db seed             # idempotent seed
```

Demo accounts (created only when `SEED_DEMO_PASSWORD` is set in `.env.local`):
`demo.customer@certibuy.test` (customer), `demo.technician@certibuy.test` (technician, Indiranagar hub),
`demo.ops@certibuy.test` (ops + platform admin). Staff accounts must set up two-step verification at `/mfa`.

Notes: `profiles.id` stores the auth user id as text, so there is no foreign key to `auth.users` (uuid); the
auth trigger keeps them in step. The app connects as the table owner, so RLS is the last line of defence and
authorisation is enforced in `packages/application`.

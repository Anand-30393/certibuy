# CertiBuy

Custody-first refurbished-device marketplace for India — capstone rebuild, independent of Base44, built at zero cost.

- Start with [`CLAUDE.md`](CLAUDE.md), then [`docs/architecture.md`](docs/architecture.md).
- Decisions are recorded in [`docs/adr/`](docs/adr/).

**Status:** Phase 0 (foundation). The workspace is scaffolded; no application code or business logic exists yet.

## Requirements (all free)

- Node.js 24 (see `.nvmrc`)
- pnpm, run through Node's built-in corepack (no global install needed)
- Git
- A Supabase Free project, `certibuy-dev`, for development (no local Docker)

## Setup

```bash
corepack pnpm install
cp .env.example .env.local   # then fill in certibuy-dev values; never commit them
```

## Scripts

```bash
corepack pnpm lint          # ESLint, including the architecture boundary rules
corepack pnpm typecheck     # TypeScript (strict)
corepack pnpm test          # Vitest
corepack pnpm format:check  # Prettier (docs are excluded)
corepack pnpm check         # all of the above
```

If you run `corepack enable` once, you can type `pnpm` instead of `corepack pnpm`.

## Layout

```
apps/web/             Next.js app (added in a later step)
packages/domain/      pure business rules
packages/application/ use-cases: commands, read models, jobs, policies
packages/contracts/   zod schemas, enums, statuses
packages/db/          Prisma schema, migrations, Supabase-only SQL, seeds
packages/integrations/ ports, simulated adapters, Supabase auth + storage adapters
e2e/                  Playwright tests
docs/                 documentation and ADRs
```

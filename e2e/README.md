# End-to-end suites

These suites test the running app with real Supabase Auth, Storage and Postgres (the `certibuy-dev` project). Payments, payouts, the courier, grading and email are simulated. Each suite prints `PASS`/`FAIL` lines and exits non-zero if any check fails.

| Suite | Covers |
| --- | --- |
| `00-reset-mode` | Puts the demo customer back to "no mode chosen" |
| `01-roles` | Sign-in, route guards and the API role checks for every role |
| `02-seller` | Valuation, photos, self-checks, grading, offer and booking |
| `03-counter` | Technician counter: identity, grading verdicts, revised offers, mismatch, handover and payouts, hub scoping |
| `04-buyer` | Shop, cart, checkout, escrow, cancellation, shipping, returns, refunds and DOA replacement |
| `05-jobs` | Daily job, safe reruns, demo clock, escrow release, ladder, day-21 balances, payout holds and retries, notifications |
| `06-ops` | Ops console: settings history, Instant Cash pause, inventory, exceptions, finance reconciliation, support, users, invitations, audit and metrics |
| `07-journey` | One device from seller to buyer to final payout, plus concurrency checks and accepted-offer expiry |
| `08-demo-reset` | Demo reset guards and scope. Real customers' data is untouched. Runs last and removes the data the other suites made |

## Run

1. Fill in `.env.local` at the repository root. Set `DEMO_TOOLS_ENABLED=true`, and the `demo_mode` setting must be on.
2. Build and start the app: `corepack pnpm build`, then `corepack pnpm --filter @certibuy/web start -p 3100`.
3. From the repository root, run `corepack pnpm e2e`. To run only some suites, pass their numbers: `corepack pnpm e2e 03 07`.

`E2E_BASE_URL` overrides `http://localhost:3100`. The suites enrol temporary two-step factors for staff and remove them at the end. They also reset the demo clock.

These suites are not part of GitHub CI, because they need the Supabase project and its secrets.

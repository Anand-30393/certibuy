# ADR 0003 — Manually triggered jobs

**Status:** Accepted · **Date:** 14 November 2026

## Context

The daily job, liquidity recalculation, metrics, outbox delivery and checkout-hold expiry are scheduled behaviours in `docs/automations.md.txt`. Free hosting offers no precise scheduler.

## Decision

- Every job is a command triggered from Ops → Jobs (O-12); an optional free daily cron is off by default.
- Jobs process in batches (`cursor` / `done`) to fit serverless time limits.
- Every step is idempotent and acts only on records whose business dates have passed, so a late run catches up and never moves money twice.
- Time-critical checks are also enforced at the moment of action (offer expiry at accept, return window at raise, checkout hold when ordering or confirming).

## Consequences

- Ladder prices and payout states reflect the last job run; the Jobs page warns when today's daily job has not run.
- Moving to production only adds a scheduler that calls the same commands (`docs/architecture.md` §19).

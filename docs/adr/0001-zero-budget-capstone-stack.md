# ADR 0001 — Zero-budget capstone stack

**Status:** Accepted · **Date:** 14 November 2026

## Context

CertiBuy is rebuilt from its documentation, independent of Base44, as a capstone demonstration with a strict ₹0 budget. Every business rule in `docs/` must be preserved, and the code must be able to move to a paid production stack later without rewriting business logic.

## Decision

- Next.js (App Router) + React + TypeScript, one app hosted on Vercel Hobby (personal, non-commercial).
- Next.js Route Handlers as the API (`/api/v1/commands/*`, `/api/v1/views/*`); no separate server.
- Supabase Free for PostgreSQL, Auth and Storage. Development uses the cloud project `certibuy-dev`; `certibuy-demo` is reserved for the final demonstration. No local Docker stack.
- Business logic lives in framework-free packages (`packages/domain`, `packages/application`), enforced by ESLint import rules.
- Payments, payouts, courier, AI grading and notification email are simulated behind adapters.
- pnpm workspace, TypeScript (strict), ESLint, Prettier, Vitest.

## Consequences

- No paid service is required; free-tier limits are tracked in `docs/architecture.md` §3.
- Production moves are adapter and hosting swaps (`docs/architecture.md` §19).
- Development needs network access to `certibuy-dev`; the free project may pause after inactivity and must be resumed from the Supabase dashboard.

# @certibuy/application

Use-cases for CertiBuy: commands (the only way money or status changes), per-screen read models, policies and
shared write helpers. No Next.js or Supabase imports; external effects come in through ports on `AppContext`.

- `registry.ts` — `dispatch()`: sign-in, role, staff MFA, strict input validation, projected output.
- `policies.ts` — role resolution and guards (`homeFor`, `canOpenArea`, hub/owner scoping).
- `support.ts` — `notify()` (notification + simulated email outbox), activity log, advisory locks.
- `selling/` — seller journey S-01 … S-13 (`handlers.ts`), offer builder (`offer.ts`), read helpers (`queries.ts`).

## Phase 3 implementation assumptions

1. The offer is priced at the automatic grade **estimate**; the "value range" shown is the guaranteed price at the
   worst and best grade of the band.
2. Booking days are the next five business days starting **tomorrow** (no same-day slots); capacity is the hub's
   daily capacity (no per-slot limit).
3. The function grade counts the seven functional checks; activation lock and IMEI are reject gates. The
   blacklist reject uses the `blacklisted_imeis` registry, not the seller's self-check answer.
4. Retakes = shots the browser quality check rejected + shots replaced after upload (only ever lowers confidence).
5. Liquidity uses the model's current score, else its tier's cold-start score; exposure = acquisition cost of owned
   devices not yet settled or liquidated.
6. An offer past its expiry is marked expired (and the deal closed) when the seller tries to accept it.

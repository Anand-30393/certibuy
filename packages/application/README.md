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

## Phase 4 implementation assumptions (technician counter)

1. Identity passes when the scanned IMEI matches the declared one on the last 8 digits, the scanned IMEI is not
   in the blacklist registry (re-checked at the counter), and activation lock is off.
2. The technician checklist has 9 items; failed count maps to the function grade (1 → B, 2 → C, 3+ → D).
3. A grade inside (or better than) the band moves the deal straight to `accepted`; one below creates the revised
   offer immediately (priced at the confirmed grade, High confidence); if Instant Cash is no longer available at
   the lower grade, the revised offer is on the guaranteed price.
4. The seller's counter decision can be recorded by the seller (own device) or by the hub's technician.
5. A two-grade mismatch lowers the seller's trust score by 10 (the docs give no figure); the fee payout row is
   written only when the fee was collected.
6. Acquisition cost = the agreed price (Instant Cash amount or guaranteed price).
7. The counter payout (Instant Cash in full, or the Sell For More advance) is attempted through the simulated rail
   right after the handover commits; a failure leaves custody intact for the payout run to retry.

## Phase 5 implementation assumptions (buyer journey)

1. The cart is stored in the buyer's browser; the server re-validates every line (availability and price) on
   every read and at checkout. Each line is reserved in its own transaction with a conditional update.
2. A declined (simulated) payment writes nothing for any line of the checkout.
3. Buyer gallery photos are the seller's guided shots of the device, minus the IMEI/serial label shots.
4. Shipping is a simulated courier advanced by ops; in demo mode the buyer can advance their own shipment.
   Delivery marks the listing `sold` and starts the return window; dispatch marks the device `shipped`.
5. A return is re-inspected at the hub that holds custody of the device; ops may resolve before re-inspection.
6. Reserving a listing increments `reserved_days` by 1 (the daily job refines held days in Phase 6).
7. Escrow release, settlement and payout runs for delivered orders arrive with the daily job in Phase 6; for a
   replaced order, settlement must use the replacement device.

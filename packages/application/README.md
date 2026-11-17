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

## Phase 6 implementation assumptions (jobs, automation, notifications)

1. Each daily-job step writes in small transactions guarded by conditional updates (`where status = …`) and
   unique indexes, so a rerun or two overlapping runs never move money or send a reminder twice; a run is
   marked `running` in `job_runs` and a second start within 10 minutes is refused.
2. The ladder only steps down (relisting resets to step 0), so moving the demo clock back never raises prices.
3. Held days for a reserved listing never decrease: `max(current, today − paid_at + 1)`.
4. The payout run makes one attempt per payable payout per run; a failed payout stays on hold until an ops retry.
5. A missed booking becomes `no_show` and the deal returns to "book a hub slot" so the seller can rebook.
6. Liquidity "day-45 returns" = the model's listings that reached review or liquidation; demand is the documented
   proxy (F17). Fewer than 3 sales in 8 weeks → cold start.
7. Email is simulated: `notify()` queues outbox rows, delivered after each command, by the daily job and from
   Ops → Jobs; nothing leaves the system. Ops → Mail log shows every message.
8. Demo controls (advance clock, reset clock, payout-failure switch) require `demo_mode` and
   `DEMO_TOOLS_ENABLED=true`. An optional cron endpoint runs the daily job only when `CRON_SECRET` is set.

## Phase 7 implementation assumptions (operations console)

1. Every ops endpoint requires the `ops` role (platform admins pass) and, when enforced, staff MFA; customers
   and technicians are refused before any data is read. Technicians stay scoped to their own hub.
2. Role, hub, trust score, account flag and staff invitations are platform-admin only. Nobody can change their
   own role. An invitation link is created with the Supabase admin API and copied by hand (no email). The
   invited role is applied once, at the person's next sign-in, and only to a customer account.
3. Business settings are validated as a whole (ladder order, weights total 100, battery floors, grade factors,
   caps) and only changed fields are saved, with a version bump, a `settings_history` diff and an audit entry.
   The demo clock and demo switches stay under Jobs.
4. A price override can't go below the listing floor and stops the ladder until cleared. A device in
   day-45 review can be relisted or liquidated; liquidation sells to B2B at the floor in one click and is never
   automatic. Refurbished grade D lists with no warranty.
5. Return and payout-hold exceptions can only close through their own flows, so the ledgers stay correct.
   Upholding a seller's grade dispute waives a pending mismatch fee and adds 10 trust points.
6. Finance is read-only over the append-only escrow and payout ledgers. Reconciliation flags any order whose
   hold differs from its total, whose closing movements exceed the hold, or that has more than one release.
   B2B proceeds are the floor prices of liquidated listings.
7. Pausing Instant Cash withdraws it from live offers and tells those sellers. Acceptance re-checks anyway.
8. A customer may have at most 5 open support requests. Replies notify the customer and can resolve the
   request in the same step.
9. Metrics use 7-day periods ending on the business date. "Inventory beyond day 45" is a current snapshot.

## Phase 8 hardening (fixes from the end-to-end review)

1. A payout attempt is claimed (conditional update on the attempt count) before the rail is called, and a
   paid or not-yet-due payout is refused first, so a counter payout, the daily job and an ops retry racing
   on the same row move money once.
2. `runDailyJobs` refuses a future business date (catch-up for past days is still allowed); only the demo
   clock moves time forward.
3. A settled order (escrow released) can't be returned, even if the demo clock is moved back into its window,
   and `resolveReturn` refuses an order whose payment is no longer in escrow.
4. Reservations record `reserved_since`; the reserved days are added when a reservation ends, so repeated
   reservations accumulate and the demo-clock offset can't skew them. Checkout reserves only at the price
   it read.
5. Cancelling an order moves an unpaid Sell For More balance back to `due` (paid payouts are never reversed).
6. Instant Cash caps count Instant Cash already accepted but not yet handed over.
7. Concurrent resolves of the same return are serialised (order locked before the return is read); counter
   steps lock their submission row; liquidation uses conditional writes so a checkout in between wins.

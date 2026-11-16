# @certibuy/domain

Pure CertiBuy business rules (Phase 1). No database, HTTP, clock or framework: every function takes `Settings` and records as input and returns a result or throws a `DomainError` (`status` follows the API error contract, `message` is UI copy).

| Module | Rules |
| --- | --- |
| `pricing` | grade prices and fallbacks, guaranteed / Instant Cash amounts, risk tier, price band, offer expiry, launch window |
| `eligibility` | Instant Cash gates in order |
| `grading` | IMEI (Luhn), hard rejects, automatic estimate, confidence, band shapes |
| `inspection` | technician component grades, final grade, verdict, revised offer |
| `lifecycle` | price ladder, reserved days, payout state machine |
| `custody` | payout plan at handover, due balance promotion, listing creation (F9, F10) |
| `orders` | order total, checkout hold, pre-dispatch cancellation (F7) |
| `returns` | return window, eligibility, outcome matrix, refund maths, counters (F16) |
| `liquidity` | cold-start and measured liquidity score |
| `business-date`, `money` | Asia/Kolkata business date with demo offset; en-IN rupee formatting |

Tests: `src/golden.test.ts` runs every case in `__fixtures__/`; `src/domain.test.ts` covers the rest.

## Implementation assumptions (minor details the docs leave open)

1. Fallback grade prices (A × factor) are rounded to whole rupees.
2. The launch-window threshold tightening also applies to the risk-tier threshold.
3. A launch window means the successor launches within `launch_window_days` either side of today.
4. Inside a launch window, a score below the normal threshold reports `low_liquidity`; one that fails only the tightened threshold reports `launch_window`.
5. Ladder prices are rounded to ₹10 first and the floor applied last, so they never fall below the floor.
6. When components tie for worst, `worstKey` reports them in battery → cosmetic → functions order.
7. Deductions (cancellation fee, ₹300, ₹500) never exceed the order total; refunds are based on the order total including any add-on.
8. Retrying an already-failed payout that fails again does not open a second exception or re-notify.
9. A confirmed dead-on-arrival device goes to refurbishment.
10. Measured liquidity scores are rounded to 2 decimal places; floating-point noise in volatility is treated as zero.

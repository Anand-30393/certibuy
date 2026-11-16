# Golden test cases

Expected results for the pure business rules, written from the CertiBuy documentation and the confirmed decisions in `docs/architecture.md` §1 and §20. They are **test data only**: Phase 1 implements `packages/domain` and must make every `confirmed` case pass.

| File | Covers |
| --- | --- |
| `settings.default.json` | the default `Settings` record every case uses unless it says otherwise |
| `pricing.json` | grade prices and fallbacks, guaranteed and Instant Cash amounts, risk tier, price band, offer expiry |
| `ic-eligibility.json` | Instant Cash gates and their order |
| `grading.json` | automatic estimate, confidence, band shapes, hard rejects and their order, IMEI validation |
| `inspection.json` | technician component grades, final grade, verdict against the band |
| `ladder-listing.json` | price ladder, reserved days, floor price (F10), overrides, day-45 review, listing creation incl. grade D (F9) |
| `business-date.json` | business date in `Asia/Kolkata` with the demo offset |
| `payouts.json` | payout plan, due balance (D4), day-21 promotion, payout state machine |
| `orders-returns.json` | order totals, pre-dispatch cancellation (F7), return window (D3), return outcomes and deductions, return counters (F16) |
| `liquidity.json` | cold-start liquidity scores |

## Case format

```json
{
  "id": "PRC-006",
  "description": "what the case proves",
  "status": "confirmed | assumption",
  "notes": "required when status is assumption",
  "input": { },
  "expected": { }
}
```

- **confirmed**: the expected value follows directly from the documentation or a confirmed decision.
- **assumption**: the documentation is silent on a detail (for example a rounding rule or an inclusive boundary). The `notes` field states the assumption. These need business confirmation before Phase 1 treats them as binding.

All money is integer rupees; all business dates are `yyyy-mm-dd`.

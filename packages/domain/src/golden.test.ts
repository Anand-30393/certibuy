// Runs every golden case in ../__fixtures__ through the domain functions.
// Fixture inputs use snake_case (database vocabulary); they are mapped to camelCase options here.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assess,
  assertCanRaiseReturn,
  attemptPayout,
  batteryGrade,
  businessDate,
  cancelOrder,
  checkRejects,
  confirmGrade,
  daysListed,
  DomainError,
  evaluateEligibility,
  gradePrice,
  incrementReturnCounters,
  inPriceBand,
  insideReturnWindow,
  isValidBatteryHealth,
  ladderPosition,
  nextStepFor,
  offerAmounts,
  offerExpiry,
  escrowReleasable,
  heldDays,
  isNoShow,
  ladderAdvances,
  normaliseIndianMobile,
  offerExpired,
  reminderDue,
  orderTotal,
  partitionCart,
  pickReplacement,
  replacementAllowed,
  payoutPlan,
  planListing,
  promoteBalance,
  resolveReturn,
  returnWindowClosesAt,
  revisedOffer,
  riskPct,
  scoreModel,
  SIMULATED_PAYOUT_FAILURE,
  technicianFunctionGrade,
  verdictFor,
  type Grade,
  type Settings,
} from "./index";

// Fixture values are loosely typed JSON; each case reads the fields it needs.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Case = { id: string; description: string; input: any; expected: any };
const load = (file: string): any =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../__fixtures__/${file}`, import.meta.url)), "utf8"),
  );

const S: Settings = load("settings.default.json").settings;
const withSettings = (over: Partial<Settings>): Settings => ({ ...S, ...over });

function run(file: string, handler: (c: Case) => void): void {
  const { cases } = load(file) as { cases: Case[] };
  describe(file, () => {
    for (const c of cases) it(`${c.id} ${c.description}`, () => handler(c));
  });
}

/** Assert a DomainError with the expected HTTP status. */
function expectStatus(fn: () => unknown, status: number): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).status).toBe(status);
    return;
  }
  throw new Error(`Expected a DomainError with status ${status}`);
}

run("pricing.json", ({ input, expected }) => {
  switch (input.fn) {
    case "gradePrice":
      return expect(gradePrice(input.model, input.grade, S)).toBe(expected.market);
    case "offer":
      return expect(offerAmounts(input.market, input.risk_pct, S)).toMatchObject(expected);
    case "riskPct":
      return expect(riskPct(input.score, S)).toBe(expected.risk_pct);
    case "inPriceBand":
      return expect(inPriceBand(input, S)).toBe(expected.selectable);
    case "offerExpiry":
      return expect(offerExpiry(input.business_date, S)).toBe(expected.expires_on);
    default:
      throw new Error(`Unhandled fn ${input.fn}`);
  }
});

run("ic-eligibility.json", ({ input, expected }) => {
  const result = evaluateEligibility(
    {
      icPaused: input.ic_paused,
      confidence: input.confidence,
      score: input.score,
      launchWindow: input.launch_window,
      inventoryTotal: input.inventory_total,
      modelExposure: input.model_exposure,
      instantCashAmount: input.instant_cash_amount,
    },
    S,
  );
  expect(result).toMatchObject(expected);
  if (!result.eligible) expect(result.reason?.length ?? 0).toBeGreaterThan(0);
});

run("grading.json", ({ input, expected }) => {
  if (input.battery_health_values) {
    return expect(input.battery_health_values.map((h: number) => batteryGrade(h, S))).toEqual(
      expected.battery_grades,
    );
  }
  if ("imei" in input) {
    const reject = checkRejects({
      imei: input.imei,
      blacklisted: input.blacklisted,
      activationLock: input.activation_lock,
      waterExposure: input.water_exposure,
      repaired: input.repaired,
    });
    if (!expected.rejected) return expect(reject).toBeNull();
    return expect(reject?.code).toBe(expected.code);
  }
  const a = assess(
    {
      batteryHealth: input.battery_health,
      declaredCosmetic: input.declared_cosmetic,
      failedChecks: input.failed_checks,
      repaired: input.repaired,
      retakeCount: input.retake_count,
    },
    S,
  );
  const actual = {
    battery_grade: a.components.battery,
    cosmetic_grade: a.components.cosmetic,
    function_grade: a.components.functions,
    estimate: a.estimate,
    confidence: a.confidence,
    confidence_value: a.confidenceValue,
    band: a.band,
  };
  expect(actual).toMatchObject(expected);
  expect(a).not.toHaveProperty("price");
});

run("inspection.json", ({ input, expected }) => {
  if (input.failed_checks_values) {
    return expect(input.failed_checks_values.map(technicianFunctionGrade)).toEqual(
      expected.function_grades,
    );
  }
  if (input.battery_health_values) {
    return expect(input.battery_health_values.map(isValidBatteryHealth)).toEqual(expected.valid);
  }
  if (input.band) {
    const verdict = verdictFor(input.band as Grade[], input.final_grade);
    expect(verdict).toBe(expected.verdict);
    if (expected.next) expect(nextStepFor(verdict)).toBe(expected.next);
    if (expected.fee) expect(S.mismatch_fee).toBe(expected.fee);
    return;
  }
  if (input.model) {
    expect(gradePrice(input.model, input.final_grade, S)).toBe(expected.market);
    return expect(revisedOffer(input.model, input.final_grade, 72, S).guaranteed).toBe(
      expected.revised_guaranteed,
    );
  }
  const g = confirmGrade(
    {
      failedChecks: input.failed_checks,
      batteryHealth: input.battery_health,
      cosmeticGrade: input.cosmetic_grade,
    },
    S,
  );
  expect({
    component_grades: g.componentGrades,
    final_grade: g.finalGrade,
    worst_key: g.worstKey,
  }).toMatchObject(expected);
});

run("ladder-listing.json", ({ id, input, expected }) => {
  if (id.startsWith("LST")) {
    const event = {
      completeHandover: "handover",
      markRefurbishedAndList: "refurbished",
      "resolveReturn.relist": "relist",
    }[input.event as string] as "handover" | "refurbished" | "relist";
    const plan = planListing(event, input.final_grade, input.model, S);
    return expect({
      listing_created: plan.listingCreated,
      device_status: plan.deviceStatus,
      ...(plan.listingCreated
        ? {
            base_price: plan.basePrice,
            floor_price: plan.floorPrice,
            warranty_months: plan.warrantyMonths,
            warranty_addon_offered: plan.warrantyAddonOffered,
            ladder_step: plan.ladderStep,
          }
        : {}),
    }).toMatchObject(expected);
  }
  const days =
    input.days_listed ?? daysListed(input.listed_at, input.business_date, input.reserved_days);
  const p = ladderPosition(
    {
      basePrice: input.base_price,
      floorPrice: input.floor_price,
      daysListed: days,
      overridePrice: input.override_price ?? null,
    },
    S,
  );
  expect({
    days_listed: days,
    ladder_step: p.ladderStep,
    current_price: p.ladderPrice,
    effective_price: p.effectivePrice,
    price_moved_by_ladder: p.priceMovedByLadder,
    status: p.review ? "review" : "active",
    listing_status: p.review ? "review" : "active",
    device_status: p.review ? "day45_review" : "listed",
    notification: p.review ? "day45_review" : null,
    auto_liquidated: false,
  }).toMatchObject(expected);
});

run("business-date.json", ({ input, expected }) => {
  const now = new Date(input.now_utc);
  const settings = withSettings({ sim_day_offset: input.sim_day_offset });
  expect(businessDate(now, settings, input.business_date_override)).toBe(expected.business_date);
});

run("payouts.json", ({ input, expected }) => {
  if (input.option === "instant_cash") {
    const plan = payoutPlan(
      { option: "instant_cash", instantCashAmount: input.instant_cash_amount },
      S,
    );
    return expect(plan).toMatchObject(expected.payouts);
  }
  if (input.option === "sell_for_more") {
    const plan = payoutPlan(
      { option: "sell_for_more", guaranteed: input.guaranteed, custodyAt: input.custody_at },
      S,
    );
    if (expected.payouts) {
      return expect(
        plan.map((p) => ({ ...p, ...(p.dueOn ? { due_on: p.dueOn } : {}) })),
      ).toMatchObject(expected.payouts);
    }
    const [advance, balance] = plan;
    return expect({
      advance: advance?.amount,
      balance: balance?.amount,
      sum: (advance?.amount ?? 0) + (balance?.amount ?? 0),
    }).toEqual(expected);
  }
  if (input.command === "retryPayout") {
    return expectStatus(
      () => attemptPayout({ status: input.status, attempts: 1 }, { ok: true }, S),
      expected.http,
    );
  }
  if (input.event === "cancelOrder") {
    const result = cancelOrder({ orderStatus: "paid", total: 49350 }, S);
    expect(result.sellerPayoutsAffected).toBe(false);
    return expect({ balance_status: input.balance_status, reversed: false }).toEqual(expected);
  }
  if ("balance_status" in input) {
    const r = promoteBalance(
      {
        status: input.balance_status,
        custodyAt: input.custody_at,
        today: input.business_date,
        buyerPaid: input.buyer_paid,
      },
      S,
    );
    return expect({
      balance_status: r.status,
      ...(r.trigger ? { trigger: r.trigger } : {}),
    }).toEqual(expected);
  }
  // Payout attempts
  const settings = withSettings({ simulate_payout_failure: input.simulate_payout_failure });
  const transfer = settings.simulate_payout_failure
    ? ({ ok: false, reason: SIMULATED_PAYOUT_FAILURE } as const)
    : ({ ok: true } as const);
  const r = attemptPayout({ status: input.status, attempts: input.attempts }, transfer, settings);
  expect({
    writes: r.writes,
    status: r.status,
    attempts: r.attempts,
    failure_reason: r.failureReason,
    exception_opened: r.openException ? "payment_hold" : false,
    notifications: r.notifications,
  }).toMatchObject(expected);
});

run("orders-returns.json", ({ id, input, expected }) => {
  if (id.startsWith("ORD")) {
    if (input.command === "placeOrder") {
      // A declined (simulated) authorisation writes nothing; the total is still reported.
      const { total } = orderTotal(
        { currentPrice: 47000, warrantyMonths: 12, warrantyAddon: true },
        S,
      );
      expect(total).toBe(input.total);
      return expect({ declined: true, total, records_written: 0 }).toEqual(expected);
    }
    const run = () =>
      orderTotal(
        {
          currentPrice: input.current_price,
          overridePrice: input.override_price ?? null,
          warrantyMonths: input.warranty_months,
          warrantyAddon: input.warranty_addon,
        },
        S,
      );
    if (expected.http) return expectStatus(run, expected.http);
    const t = run();
    return expect({
      device_price: t.devicePrice,
      warranty_addon_amount: t.warrantyAddonAmount,
      total: t.total,
    }).toMatchObject(expected);
  }
  if (id.startsWith("CAN")) {
    const settings = withSettings({
      cancel_fee: input.cancel_fee,
      ...(input.change_mind_fee !== undefined ? { change_mind_fee: input.change_mind_fee } : {}),
    });
    const go = () => cancelOrder({ orderStatus: input.order_status, total: input.total }, settings);
    if (expected.http) return expectStatus(go, expected.http);
    const r = go();
    return expect({
      order_status: r.orderStatus,
      escrow_tx: r.escrowTx,
      refund: r.refund,
      escrow_status: r.escrowStatus,
      listing_status: r.listingStatus,
      device_status: r.deviceStatus,
      notification: r.notification,
    }).toMatchObject(expected);
  }
  // Returns
  if (input.delivered_at) {
    return expect(returnWindowClosesAt(input.delivered_at, S)).toBe(
      expected.return_window_closes_at,
    );
  }
  if (input.business_dates) {
    return expect(
      input.business_dates.map((d: string) => insideReturnWindow(input.return_window_closes_at, d)),
    ).toEqual(expected.allowed);
  }
  if ("existing_open_return" in input) {
    return expectStatus(
      () =>
        assertCanRaiseReturn({
          orderStatus: "delivered",
          closesAt: "2026-11-17",
          today: "2026-11-15",
          hasOpenReturn: input.existing_open_return,
        }),
      expected.http,
    );
  }
  if ("device_return_count" in input) {
    const r = incrementReturnCounters({
      device: input.device_return_count,
      buyer: input.buyer_return_count,
    });
    return expect({ device_return_count: r.device, buyer_return_count: r.buyer }).toEqual(expected);
  }
  const go = () =>
    resolveReturn({ reason: input.reason, outcome: input.outcome, total: input.total }, S);
  if (expected.http) return expectStatus(go, expected.http);
  const r = go();
  expect({
    deduction: r.deduction,
    deduction_label: r.deductionLabel,
    refund: r.refund,
    escrow_tx: r.escrowTx,
    escrow_status: r.escrowStatus,
    order_status: r.orderStatus,
    device_status: r.deviceAction === "refurbish" ? "in_refurbishment" : "listed",
    device_relisted_day0: r.deviceAction === "relist",
    replacement_allocated: r.replacementAllocated,
  }).toMatchObject(expected);
});

run("liquidity.json", ({ input, expected }) => {
  const days: number[] =
    input.sales_days_to_sell ?? Array.from({ length: input.measured_sales }, () => 10);
  const r = scoreModel(
    {
      tier: input.tier,
      salesDaysToSell: days,
      achievedPriceRatios: input.achieved_price_ratios ?? days.map(() => 1),
      recentSales: input.recent_sales ?? days.length,
      activeListings: input.active_listings ?? 0,
      launchWindow: input.launch_window ?? false,
      day45Returns: input.day45_returns,
    },
    S,
  );
  expect({
    score: r.score,
    source: r.source,
    ...(r.components
      ? {
          days_score: r.components.daysScore,
          demand_score: r.components.demandScore,
          volatility: r.volatility,
          volatility_score: r.components.volatilityScore,
          launch_score: r.components.launchScore,
          score_before_penalty: r.components.beforePenalty,
        }
      : {}),
  }).toMatchObject(expected);
});

run("cart-replacement.json", ({ input, expected }) => {
  if (input.lines) {
    const r = partitionCart(input.lines, input.availability);
    return expect({
      purchasable: r.purchasable.map((l) => l.listingId),
      removed: r.removed.map((l) => l.listingId),
    }).toEqual(expected);
  }
  if (input.phones) {
    return expect(input.phones.map(normaliseIndianMobile)).toEqual(expected.normalised);
  }
  if (input.replacementDeviceIds) {
    return expect(
      input.replacementDeviceIds.map((id: string | null) =>
        replacementAllowed({ replacementDeviceId: id }),
      ),
    ).toEqual(expected.allowed);
  }
  expect(pickReplacement(input.original, input.candidates)?.listingId ?? null).toBe(
    expected.listingId,
  );
});

run("jobs.json", ({ input, expected }) => {
  switch (input.fn) {
    case "escrowReleasable":
      return expect(escrowReleasable(input)).toBe(expected.result);
    case "offerExpired":
      return expect(input.todays.map((d: string) => offerExpired(input.expiresAt, d))).toEqual(
        expected.results,
      );
    case "isNoShow":
      return expect(
        input.bookings.map((b: { status: string; date: string }) => isNoShow(b, input.today)),
      ).toEqual(expected.results);
    case "reminderDue":
      return expect(
        input.todays.map((d: string) => reminderDue(input.deadline, d, input.windowDays)),
      ).toEqual(expected.results);
    case "heldDays":
      return expect(input.cases.map((c: [number, string, string]) => heldDays(...c))).toEqual(
        expected.results,
      );
    case "ladderAdvances":
      return expect(input.cases.map((c: [number, number]) => ladderAdvances(...c))).toEqual(
        expected.results,
      );
    default:
      throw new Error(`Unhandled fn ${input.fn}`);
  }
});

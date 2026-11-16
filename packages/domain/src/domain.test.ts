// Unit tests for behaviour the golden cases do not cover directly.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  addDays,
  assertCanRaiseReturn,
  attemptPayout,
  bandFor,
  cancelOrder,
  confirmGrade,
  diffDays,
  DomainError,
  estimateRefund,
  evaluateEligibility,
  formatInr,
  GRADES,
  holdExpiresAt,
  inLaunchWindow,
  isValidBand,
  isValidImei,
  ladderPosition,
  planListing,
  requireSettings,
  reservedDaysSince,
  scoreModel,
  worstGrade,
  type ConfidenceLevel,
  type Settings,
} from "./index";

const S: Settings = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../__fixtures__/settings.default.json", import.meta.url)),
    "utf8",
  ),
).settings;

describe("money and dates", () => {
  it("formats rupees in en-IN grouping without paise", () => {
    expect(formatInr(132000)).toBe("₹1,32,000");
    expect(formatInr(50800)).toBe("₹50,800");
  });

  it("adds and diffs business days across month and year ends", () => {
    expect(addDays("2026-12-25", 10)).toBe("2027-01-04");
    expect(diffDays("2026-02-20", "2026-03-02")).toBe(10);
    expect(() => addDays("16/11/2026", 1)).toThrow(RangeError);
  });

  it("counts held days for a reserved listing from the payment day", () => {
    expect(reservedDaysSince("2026-11-10", "2026-11-10")).toBe(1);
    expect(reservedDaysSince("2026-11-10", "2026-11-14")).toBe(5);
    expect(reservedDaysSince("2026-11-10", "2026-11-09")).toBe(0);
  });
});

describe("settings", () => {
  it("refuses to run without Settings and never invents defaults", () => {
    expect(() => requireSettings(null)).toThrow("Settings are missing.");
    expect(requireSettings(S)).toBe(S);
  });
});

describe("grading invariants", () => {
  it("validates IMEIs: 15 digits and Luhn", () => {
    expect(isValidImei("490154203237518")).toBe(true);
    expect(isValidImei("49015420323751a")).toBe(false);
  });

  it("produces only contiguous bands of 1–3 grades that include the estimate", () => {
    const levels: ConfidenceLevel[] = ["High", "Medium", "Low"];
    for (const g of GRADES) {
      for (const c of levels) {
        const band = bandFor(g, c);
        expect(isValidBand(band)).toBe(true);
        expect(band).toContain(g);
      }
    }
    expect(isValidBand(["A", "C"])).toBe(false);
  });

  it("picks the worst grade", () => {
    expect(worstGrade("A", "C", "B")).toBe("C");
  });
});

describe("inspection", () => {
  it("rejects a battery reading outside 50–100", () => {
    expect(() =>
      confirmGrade({ failedChecks: 0, batteryHealth: 40, cosmeticGrade: "A" }, S),
    ).toThrow(DomainError);
  });
});

describe("eligibility gate order with a launch window", () => {
  const base = {
    icPaused: false,
    confidence: "High" as const,
    launchWindow: true,
    inventoryTotal: 0,
    modelExposure: 0,
    instantCashAmount: 1000,
  };
  it("reports low_liquidity when the score fails even the normal threshold", () => {
    expect(evaluateEligibility({ ...base, score: 55 }, S).reasonLabel).toBe("low_liquidity");
  });
  it("reports launch_window when only the tightened threshold fails", () => {
    expect(evaluateEligibility({ ...base, score: 65 }, S).reasonLabel).toBe("launch_window");
  });
  it("treats a successor launching within launch_window_days as a launch window", () => {
    expect(inLaunchWindow("2026-12-10", "2026-11-16", S)).toBe(true);
    expect(inLaunchWindow("2027-03-01", "2026-11-16", S)).toBe(false);
    expect(inLaunchWindow(null, "2026-11-16", S)).toBe(false);
  });
});

describe("ladder", () => {
  it("never prices below the floor, even after rounding", () => {
    const p = ladderPosition({ basePrice: 36000, floorPrice: 31684, daysListed: 30 }, S);
    expect(p.ladderPrice).toBeGreaterThanOrEqual(31684);
  });
});

describe("payout retries", () => {
  it("does not open a second exception when a failed payout fails again", () => {
    const r = attemptPayout(
      { status: "failed", attempts: 3 },
      { ok: false, reason: "Account name mismatch" },
      S,
    );
    expect(r.status).toBe("failed");
    expect(r.openException).toBe(false);
  });
  it("pays a failed payout on a successful ops retry", () => {
    expect(attemptPayout({ status: "failed", attempts: 3 }, { ok: true }, S).status).toBe("paid");
  });
});

describe("listing", () => {
  it("refuses to list a model without a B2B floor price", () => {
    expect(() =>
      planListing("handover", "A", { market_price_a: 50000, b2b_floor_price: null }, S),
    ).toThrow(DomainError);
  });
});

describe("orders and returns", () => {
  it("is idempotent when cancelling an already cancelled order", () => {
    expect(cancelOrder({ orderStatus: "cancelled", total: 1000 }, S).already).toBe(true);
  });

  it("holds a listing for checkout_hold_minutes", () => {
    const at = new Date("2026-11-16T10:00:00Z");
    expect(holdExpiresAt(at, S).toISOString()).toBe("2026-11-16T10:15:00.000Z");
  });

  it("estimates the refund before a return is raised", () => {
    expect(estimateRefund("buyer_changed_mind", 49350, S).refund).toBe(48850);
    expect(estimateRefund("not_as_graded", 49350, S).refund).toBe(49350);
  });

  it("refuses a return before delivery or after the window", () => {
    const base = { closesAt: "2026-11-17", today: "2026-11-15", hasOpenReturn: false };
    expect(() => assertCanRaiseReturn({ ...base, orderStatus: "paid" })).toThrow(DomainError);
    expect(() =>
      assertCanRaiseReturn({ ...base, orderStatus: "delivered", today: "2026-11-18" }),
    ).toThrow(DomainError);
    expect(() => assertCanRaiseReturn({ ...base, orderStatus: "delivered" })).not.toThrow();
  });
});

describe("liquidity", () => {
  it("lowers the score for price volatility", () => {
    const r = scoreModel(
      {
        tier: "medium",
        salesDaysToSell: [20, 22, 23, 25],
        achievedPriceRatios: [0.9, 1.1, 0.9, 1.1],
        recentSales: 4,
        activeListings: 1,
        launchWindow: false,
        day45Returns: 0,
      },
      S,
    );
    expect(r.volatility).toBe(10);
    expect(r.score).toBe(77);
  });
});

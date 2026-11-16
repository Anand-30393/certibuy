// Pricing engine: grade prices, offer amounts, risk tier, price band, offer expiry.
// docs/overview.md.txt §6, docs/architecture.md §9.1. The grader never prices; this does.
import { addDays } from "./business-date";
import { DomainError } from "./errors";
import { percentOf } from "./money";
import type { Grade, IsoDate, ModelPrices, Settings } from "./types";

function gradeFactor(grade: Exclude<Grade, "A">, s: Settings): number {
  if (grade === "B") return s.grade_factor_b;
  if (grade === "C") return s.grade_factor_c;
  return s.grade_factor_d;
}

function ownGradePrice(model: ModelPrices, grade: Grade): number | null | undefined {
  if (grade === "A") return model.market_price_a;
  if (grade === "B") return model.market_price_b;
  if (grade === "C") return model.market_price_c;
  return model.market_price_d;
}

/**
 * Market price of a grade: its own catalogue price, else grade A × the grade factor.
 * Assumption: the fallback is rounded to whole rupees.
 */
export function gradePrice(model: ModelPrices, grade: Grade, s: Settings): number {
  const own = ownGradePrice(model, grade);
  if (own != null) return own;
  if (grade === "A" || !(model.market_price_a > 0)) {
    throw new DomainError(400, "price_missing", "This model has no grade A market price yet.");
  }
  return Math.round(model.market_price_a * gradeFactor(grade, s));
}

export interface OfferAmounts {
  market: number;
  commission: number;
  inspection_fee: number;
  risk: number;
  risk_pct: number;
  guaranteed: number;
  instant_cash: number;
}

/** Guaranteed (Sell For More) and Instant Cash amounts for a market price. */
export function offerAmounts(market: number, riskPct: number, s: Settings): OfferAmounts {
  const net = market * (1 - s.commission_pct / 100) - s.inspection_fee;
  return {
    market,
    commission: percentOf(market, s.commission_pct),
    inspection_fee: s.inspection_fee,
    risk: percentOf(market, riskPct),
    risk_pct: riskPct,
    guaranteed: Math.round(net),
    instant_cash: Math.round(net - (market * riskPct) / 100),
  };
}

/** Instant Cash threshold, tightened inside a successor launch window. */
export function effectiveThreshold(launchWindow: boolean, s: Settings): number {
  return s.liquidity_threshold + (launchWindow ? s.launch_tighten_pts : 0);
}

/**
 * Risk haircut: fast-selling (risk_small_pct) when score ≥ threshold + near_band, else steady.
 * Assumption: the launch-window tightening also applies to this threshold.
 */
export function riskPct(score: number, s: Settings, launchWindow = false): number {
  return score >= effectiveThreshold(launchWindow, s) + s.near_band
    ? s.risk_small_pct
    : s.risk_large_pct;
}

export function riskTierLabel(pct: number, s: Settings): "Fast-selling" | "Steady" {
  return pct === s.risk_small_pct ? "Fast-selling" : "Steady";
}

/** Tradeable price band, inclusive, compared on the grade-A market price (confirmed PRC-014). */
export function inPriceBand(model: Pick<ModelPrices, "market_price_a">, s: Settings): boolean {
  return model.market_price_a >= s.price_band_min && model.market_price_a <= s.price_band_max;
}

/** Offer expiry: offer_expiry_days after the business date it was made. */
export function offerExpiry(madeOn: IsoDate, s: Settings): IsoDate {
  return addDays(madeOn, s.offer_expiry_days);
}

/**
 * Successor launch window. Assumption: the window covers launch_window_days either side
 * of the successor's launch date.
 */
export function inLaunchWindow(
  successorLaunchDate: IsoDate | null | undefined,
  today: IsoDate,
  s: Settings,
): boolean {
  if (!successorLaunchDate) return false;
  const days = Math.abs(
    (Date.parse(`${successorLaunchDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );
  return days <= s.launch_window_days;
}

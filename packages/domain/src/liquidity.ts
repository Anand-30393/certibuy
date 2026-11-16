// Liquidity score. docs/automations.md.txt §4 — documented formula, every component capped 0–100
// (confirmed 16 November 2026). Cold start below 3 measured sales.
import type { LiquidityTier, Settings } from "./types";

/** Cold-start scores by tier (engine shape constants, CLAUDE.md §2.1). */
export const COLD_START_SCORE: Record<LiquidityTier, number> = { high: 80, medium: 65, low: 45 };
export const MIN_MEASURED_SALES = 3;

const cap = (x: number): number => Math.min(100, Math.max(0, x));
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export interface LiquidityInput {
  tier: LiquidityTier;
  /** Days from listing to sale for each unit sold in the last 8 weeks. */
  salesDaysToSell: readonly number[];
  /** Achieved price ÷ market_price_a for each of those sales. */
  achievedPriceRatios: readonly number[];
  recentSales: number;
  activeListings: number;
  launchWindow: boolean;
  day45Returns: number;
}

export interface LiquidityResult {
  score: number;
  source: "measured" | "cold_start";
  daysToSell: number | null;
  volatility: number | null;
  components?: {
    daysScore: number;
    demandScore: number;
    volatilityScore: number;
    launchScore: number;
    beforePenalty: number;
  };
}

/** Assumption: a final score with fractions is rounded to 2 decimal places. */
const round2 = (x: number): number => Math.round(x * 100) / 100;

export function scoreModel(input: LiquidityInput, s: Settings): LiquidityResult {
  const penalty = s.liq_review_penalty * input.day45Returns;
  const sales = input.salesDaysToSell.length;
  if (sales < MIN_MEASURED_SALES) {
    return {
      score: cap(COLD_START_SCORE[input.tier] - penalty),
      source: "cold_start",
      daysToSell: sales ? mean(input.salesDaysToSell) : null,
      volatility: null,
    };
  }

  const avgDays = mean(input.salesDaysToSell);
  const daysScore = cap(
    (100 * (s.review_day - Math.min(avgDays, s.review_day))) / (s.review_day - s.review_day / 6),
  );
  const totalSupply = input.recentSales + input.activeListings;
  const demandScore = cap(totalSupply > 0 ? (100 * input.recentSales) / totalSupply : 0);

  const ratioMean = mean(input.achievedPriceRatios);
  const variance = mean(input.achievedPriceRatios.map((r) => (r - ratioMean) ** 2));
  // Population standard deviation; tiny float noise below 1e-9 is treated as zero.
  const stdev = variance < 1e-18 ? 0 : Math.sqrt(variance);
  const volatility = ratioMean > 0 ? (stdev / ratioMean) * 100 : 0;
  const volatilityScore = cap(100 - volatility);
  const launchScore = input.launchWindow ? 0 : 100;

  const beforePenalty =
    (s.liq_w_days / 100) * daysScore +
    (s.liq_w_demand / 100) * demandScore +
    (s.liq_w_volatility / 100) * volatilityScore +
    (s.liq_w_launch / 100) * launchScore;

  return {
    score: round2(cap(beforePenalty - penalty)),
    source: "measured",
    daysToSell: avgDays,
    volatility: round2(volatility),
    components: {
      daysScore: round2(daysScore),
      demandScore: round2(demandScore),
      volatilityScore: round2(volatilityScore),
      launchScore,
      beforePenalty: round2(beforePenalty),
    },
  };
}

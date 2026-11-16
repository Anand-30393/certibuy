// Shared domain vocabulary. Entity-shaped records keep the database's snake_case
// (docs/database.md.txt); function options use camelCase (CLAUDE.md §6).

export type Grade = "A" | "B" | "C" | "D";
export const GRADES: readonly Grade[] = ["A", "B", "C", "D"];

export type ConfidenceLevel = "High" | "Medium" | "Low";
export type Repaired = "no" | "authorised" | "other_shop" | "not_sure";
export type PayoutOption = "instant_cash" | "sell_for_more";
export type LiquidityTier = "high" | "medium" | "low";

/** yyyy-mm-dd business day in Asia/Kolkata. */
export type IsoDate = string;

export interface Settings {
  commission_pct: number;
  inspection_fee: number;
  mismatch_fee: number;
  return_logistics_charge: number;
  change_mind_fee: number;
  warranty_months: number;
  warranty_addon_pct: number;
  advance_pct: number;
  balance_day: number;
  payout_max_attempts: number;
  step1_day: number;
  step1_pct: number;
  step2_day: number;
  step2_pct: number;
  review_day: number;
  alert_window_days: number;
  return_window_days: number;
  liquidity_threshold: number;
  near_band: number;
  risk_small_pct: number;
  risk_large_pct: number;
  launch_window_days: number;
  launch_tighten_pts: number;
  liq_w_days: number;
  liq_w_demand: number;
  liq_w_volatility: number;
  liq_w_launch: number;
  liq_review_penalty: number;
  inventory_cap: number;
  per_model_cap: number;
  price_band_min: number;
  price_band_max: number;
  grade_factor_b: number;
  grade_factor_c: number;
  grade_factor_d: number;
  battery_a_min: number;
  battery_b_min: number;
  battery_c_min: number;
  photo_retake_medium: number;
  photo_min_px: number;
  photo_min_brightness: number;
  offer_expiry_days: number;
  checkout_hold_minutes: number;
  cancel_fee: number;
  hub_cost: number;
  demo_mode: boolean;
  sim_day_offset: number;
  simulate_payout_failure: boolean;
}

/** The catalogue fields the pricing engine reads from a DeviceModel. */
export interface ModelPrices {
  market_price_a: number;
  market_price_b?: number | null;
  market_price_c?: number | null;
  market_price_d?: number | null;
  b2b_floor_price?: number | null;
}

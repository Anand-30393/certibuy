// Pure rules for the operations console: metrics maths, stock-age buckets and Settings validation.
import { addDays, diffDays } from "./business-date";
import type { IsoDate, Settings } from "./types";

/** Median of a list (mean of the two middle values for an even count); null when empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Percentage rounded to one decimal; null when there is nothing to divide by. */
export function percent(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

/** Start dates of the last `count` weeks (7-day periods ending on `today`), oldest first. */
export function weekStarts(today: IsoDate, count: number): IsoDate[] {
  return Array.from({ length: count }, (_, i) => addDays(today, -7 * (count - i) + 1));
}

/** Index of the week (from `weekStarts`) a date falls in, or -1 if outside the window. */
export function weekIndex(date: IsoDate, today: IsoDate, count: number): number {
  const back = diffDays(date, today);
  if (back < 0 || back >= count * 7) return -1;
  return count - 1 - Math.floor(back / 7);
}

export type AgeBucket = "0-14" | "15-29" | "30-44" | "45+";

/** Stock-age buckets aligned to the ladder (step 1, step 2, review day). */
export function ageBucket(
  daysListed: number,
  s: Pick<Settings, "step1_day" | "step2_day" | "review_day">,
): AgeBucket {
  if (daysListed >= s.review_day) return "45+";
  if (daysListed >= s.step2_day) return "30-44";
  if (daysListed >= s.step1_day) return "15-29";
  return "0-14";
}

/** Fields ops may edit on the pricing board (never the demo clock or demo switches). */
export const EDITABLE_SETTINGS = [
  "commission_pct",
  "inspection_fee",
  "mismatch_fee",
  "return_logistics_charge",
  "change_mind_fee",
  "warranty_months",
  "warranty_addon_pct",
  "advance_pct",
  "balance_day",
  "payout_max_attempts",
  "step1_day",
  "step1_pct",
  "step2_day",
  "step2_pct",
  "review_day",
  "alert_window_days",
  "return_window_days",
  "liquidity_threshold",
  "near_band",
  "risk_small_pct",
  "risk_large_pct",
  "launch_window_days",
  "launch_tighten_pts",
  "liq_w_days",
  "liq_w_demand",
  "liq_w_volatility",
  "liq_w_launch",
  "liq_review_penalty",
  "inventory_cap",
  "per_model_cap",
  "price_band_min",
  "price_band_max",
  "grade_factor_b",
  "grade_factor_c",
  "grade_factor_d",
  "battery_a_min",
  "battery_b_min",
  "battery_c_min",
  "photo_retake_medium",
  "photo_min_px",
  "photo_min_brightness",
  "offer_expiry_days",
  "checkout_hold_minutes",
  "cancel_fee",
  "hub_cost",
] as const satisfies readonly (keyof Settings)[];
export type EditableSetting = (typeof EDITABLE_SETTINGS)[number];

/**
 * Validate a Settings change against the merged result. Returns UI-ready error sentences (empty
 * when valid). Business numbers stay data; these checks only stop combinations that break engines.
 */
export function validateSettingsPatch(
  current: Settings,
  patch: Partial<Record<EditableSetting, number>>,
): string[] {
  const s = { ...current, ...patch };
  const errors: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(EDITABLE_SETTINGS as readonly string[]).includes(k))
      errors.push(`${k} can't be changed here.`);
    else if (typeof v !== "number" || !Number.isFinite(v) || v < 0)
      errors.push(`${k} must be a number of zero or more.`);
  }
  const pct = [
    "commission_pct",
    "warranty_addon_pct",
    "advance_pct",
    "step1_pct",
    "step2_pct",
    "risk_small_pct",
    "risk_large_pct",
  ] as const;
  for (const k of pct) if (s[k] > 100) errors.push(`${k} must be 100 or less.`);
  if (!(s.step1_day < s.step2_day && s.step2_day < s.review_day))
    errors.push("Ladder days must increase: step 1 < step 2 < review day.");
  if (s.step2_pct < s.step1_pct)
    errors.push("The second ladder step must cut at least as much as the first.");
  if (s.liq_w_days + s.liq_w_demand + s.liq_w_volatility + s.liq_w_launch !== 100)
    errors.push("Liquidity weights must add up to 100.");
  if (!(s.battery_a_min > s.battery_b_min && s.battery_b_min > s.battery_c_min))
    errors.push("Battery floors must decrease from grade A to C.");
  if (!(
    1 > s.grade_factor_b &&
    s.grade_factor_b > s.grade_factor_c &&
    s.grade_factor_c > s.grade_factor_d &&
    s.grade_factor_d > 0
  )) {
    errors.push("Grade factors must decrease: 1 > B > C > D > 0.");
  }
  if (s.price_band_min >= s.price_band_max)
    errors.push("The price band minimum must be below the maximum.");
  if (s.risk_small_pct > s.risk_large_pct)
    errors.push("Fast-selling risk must not exceed the steady risk.");
  if (s.per_model_cap > s.inventory_cap)
    errors.push("The per-model cap must not exceed the inventory cap.");
  if (s.payout_max_attempts < 1 || s.return_window_days < 1 || s.offer_expiry_days < 1) {
    errors.push("Payout attempts, return window and offer expiry must be at least 1.");
  }
  return errors;
}

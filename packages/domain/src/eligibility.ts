// Instant Cash eligibility (S-08): ordered gates, first failure wins.
import type { ConfidenceLevel, Settings } from "./types";
import { effectiveThreshold, riskPct } from "./pricing";

export type IneligibleReason =
  "paused" | "low_confidence" | "low_liquidity" | "launch_window" | "inventory_cap" | "model_cap";

export interface EligibilityInput {
  icPaused: boolean;
  confidence: ConfidenceLevel;
  score: number;
  launchWindow: boolean;
  /** Acquisition cost of all stock CertiBuy currently owns. */
  inventoryTotal: number;
  /** Acquisition cost of this model's owned stock. */
  modelExposure: number;
  /** The Instant Cash amount this purchase would add. */
  instantCashAmount: number;
}

export interface Eligibility {
  eligible: boolean;
  reasonLabel: IneligibleReason | null;
  reason: string | null;
  score: number;
  threshold: number;
  launchWindow: boolean;
  riskPct: number;
}

const REASONS: Record<IneligibleReason, string> = {
  paused:
    "Instant Cash is paused for this model right now. The guaranteed price is still available.",
  low_confidence:
    "We need a clearer picture of this device before we can buy it outright. The guaranteed price is still available.",
  low_liquidity:
    "This model doesn't sell quickly enough for Instant Cash. The guaranteed price is still available.",
  launch_window:
    "A newer model is launching soon, so Instant Cash is limited for now. The guaranteed price is still available.",
  inventory_cap:
    "We're holding as much stock as we can right now. The guaranteed price is still available.",
  model_cap:
    "We're holding as many of this model as we can right now. The guaranteed price is still available.",
};

export function evaluateEligibility(input: EligibilityInput, s: Settings): Eligibility {
  const threshold = effectiveThreshold(input.launchWindow, s);
  const base = {
    score: input.score,
    threshold,
    launchWindow: input.launchWindow,
    riskPct: riskPct(input.score, s, input.launchWindow),
  };
  const fail = (reasonLabel: IneligibleReason): Eligibility => ({
    ...base,
    eligible: false,
    reasonLabel,
    reason: REASONS[reasonLabel],
  });

  if (input.icPaused) return fail("paused");
  if (input.confidence === "Low") return fail("low_confidence");
  if (input.score < s.liquidity_threshold) return fail("low_liquidity");
  if (input.score < threshold) return fail("launch_window");
  // Confirmed ICE-009 / ICE-010: fail when current exposure + this purchase exceeds the cap.
  if (input.inventoryTotal + input.instantCashAmount > s.inventory_cap)
    return fail("inventory_cap");
  if (input.modelExposure + input.instantCashAmount > s.per_model_cap) return fail("model_cap");
  return { ...base, eligible: true, reasonLabel: null, reason: null };
}

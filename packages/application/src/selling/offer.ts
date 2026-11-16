// Pure offer builder: grade estimate + liquidity + exposure → offer amounts and eligibility.
// Composes the Phase 1 domain modules; no database access (unit-testable).
import {
  advanceSplit,
  evaluateEligibility,
  gradePrice,
  offerAmounts,
  riskPct,
  riskTierLabel,
  type ConfidenceLevel,
  type Grade,
  type ModelPrices,
  type Settings,
} from "@certibuy/domain";

export interface OfferInput {
  model: ModelPrices;
  estimate: Grade;
  band: Grade[];
  confidence: ConfidenceLevel;
  score: number;
  launchWindow: boolean;
  icPaused: boolean;
  inventoryTotal: number;
  modelExposure: number;
}

export interface BuiltOffer {
  market: number;
  commission: number;
  inspectionFee: number;
  risk: number;
  riskPct: number;
  riskTier: "low" | "medium" | "high";
  riskTierLabel: string;
  guaranteed: number;
  instantCash: number;
  icEligible: boolean;
  icReason: string | null;
  icReasonLabel: string | null;
  advance: number;
  balance: number;
  /** Guaranteed price at the worst and best grade of the band (shown as the value range). */
  valueRange: { low: number; high: number };
}

/**
 * The offer is priced at the estimate grade. Assumption: the value range shown to the seller is
 * the guaranteed price at each end of the band.
 */
export function buildOffer(input: OfferInput, s: Settings): BuiltOffer {
  const pct = riskPct(input.score, s, input.launchWindow);
  const priced = offerAmounts(gradePrice(input.model, input.estimate, s), pct, s);
  const eligibility = evaluateEligibility(
    {
      icPaused: input.icPaused,
      confidence: input.confidence,
      score: input.score,
      launchWindow: input.launchWindow,
      inventoryTotal: input.inventoryTotal,
      modelExposure: input.modelExposure,
      instantCashAmount: priced.instant_cash,
    },
    s,
  );
  const guaranteedAt = (g: Grade) => offerAmounts(gradePrice(input.model, g, s), pct, s).guaranteed;
  const ends = input.band.map(guaranteedAt);
  const { advance, balance } = advanceSplit(priced.guaranteed, s);

  return {
    market: priced.market,
    commission: priced.commission,
    inspectionFee: priced.inspection_fee,
    risk: priced.risk,
    riskPct: pct,
    riskTier: !eligibility.eligible ? "high" : pct === s.risk_small_pct ? "low" : "medium",
    riskTierLabel: riskTierLabel(pct, s),
    guaranteed: priced.guaranteed,
    instantCash: priced.instant_cash,
    icEligible: eligibility.eligible,
    icReason: eligibility.reason,
    icReasonLabel: eligibility.reasonLabel,
    advance,
    balance,
    valueRange: { low: Math.min(...ends), high: Math.max(...ends) },
  };
}

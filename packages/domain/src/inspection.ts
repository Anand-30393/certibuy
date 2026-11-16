// Counter inspection (T-03/T-04/T-05): technician grade, verdict against the AI band.
import { DomainError } from "./errors";
import { batteryGrade, gradeIndex, worstGrade } from "./grading";
import { gradePrice, offerAmounts, riskPct } from "./pricing";
import type { Grade, ModelPrices, Settings } from "./types";

/** Technician mapping: 0 failed → A, 1 → B, 2 → C, 3+ → D. */
export function technicianFunctionGrade(failedChecks: number): Grade {
  if (failedChecks <= 0) return "A";
  if (failedChecks === 1) return "B";
  if (failedChecks === 2) return "C";
  return "D";
}

export function isValidBatteryHealth(health: number): boolean {
  return Number.isFinite(health) && health >= 50 && health <= 100;
}

export type ComponentKey = "battery" | "cosmetic" | "functions";

export interface ConfirmedGrade {
  componentGrades: Record<ComponentKey, Grade>;
  finalGrade: Grade;
  /** The component that set the final grade (first in battery → cosmetic → functions order). */
  worstKey: ComponentKey;
}

export function confirmGrade(
  input: { failedChecks: number; batteryHealth: number; cosmeticGrade: Grade },
  s: Settings,
): ConfirmedGrade {
  if (!isValidBatteryHealth(input.batteryHealth)) {
    throw new DomainError(
      400,
      "battery_out_of_range",
      "Battery health must be between 50 and 100.",
    );
  }
  const componentGrades: Record<ComponentKey, Grade> = {
    battery: batteryGrade(input.batteryHealth, s),
    cosmetic: input.cosmeticGrade,
    functions: technicianFunctionGrade(input.failedChecks),
  };
  const finalGrade = worstGrade(
    componentGrades.battery,
    componentGrades.cosmetic,
    componentGrades.functions,
  );
  const worstKey =
    (["battery", "cosmetic", "functions"] as const).find(
      (k) => componentGrades[k] === finalGrade,
    ) ?? "battery";
  return { componentGrades, finalGrade, worstKey };
}

export type Verdict = "inside" | "one_below" | "two_below";

/** Inside (or better than) the band → inside (confirmed INS-008); 1 below → one_below; 2+ → two_below. */
export function verdictFor(band: readonly Grade[], finalGrade: Grade): Verdict {
  const worstInBand = Math.max(...band.map(gradeIndex));
  const below = gradeIndex(finalGrade) - worstInBand;
  if (below <= 0) return "inside";
  return below === 1 ? "one_below" : "two_below";
}

export type NextStep = "price_stands" | "revised_offer" | "mismatch";

export function nextStepFor(verdict: Verdict): NextStep {
  if (verdict === "inside") return "price_stands";
  return verdict === "one_below" ? "revised_offer" : "mismatch";
}

/** Revised offer amounts at the technician's confirmed grade. */
export function revisedOffer(
  model: ModelPrices,
  finalGrade: Grade,
  score: number,
  s: Settings,
  launchWindow = false,
) {
  const market = gradePrice(model, finalGrade, s);
  return offerAmounts(market, riskPct(score, s, launchWindow), s);
}

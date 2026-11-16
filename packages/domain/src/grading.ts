// Automatic grading (S-06): hard rejects, estimate, confidence, band. Never returns a price.
// docs/ai-integration.md.txt §3–§5.
import { GRADES, type ConfidenceLevel, type Grade, type Repaired, type Settings } from "./types";

export function gradeIndex(grade: Grade): number {
  return GRADES.indexOf(grade);
}

/** The worst (lowest) grade of those given. */
export function worstGrade(...grades: Grade[]): Grade {
  return grades.reduce((worst, g) => (gradeIndex(g) > gradeIndex(worst) ? g : worst), "A");
}

function gradeAt(index: number): Grade {
  return GRADES[Math.min(GRADES.length - 1, Math.max(0, index))] as Grade;
}

// --- IMEI -------------------------------------------------------------------

export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** 15 digits and a passing Luhn check. */
export function isValidImei(imei: string): boolean {
  return /^\d{15}$/.test(imei) && luhnValid(imei);
}

// --- Hard rejects -----------------------------------------------------------

export type RejectCode =
  "blacklisted_imei" | "activation_lock" | "water_exposure" | "other_shop_repair" | "invalid_imei";

export const REJECT_COPY: Record<RejectCode, string> = {
  blacklisted_imei: "This IMEI has been reported blacklisted, so we can't buy this device.",
  activation_lock:
    "Activation lock is still on. Turn it off on the device, then run the checks again.",
  water_exposure: "Devices that have been exposed to water can't be bought, even after a repair.",
  other_shop_repair: "Repairs at a shop other than an authorised service centre can't be accepted.",
  invalid_imei:
    "That IMEI isn't valid. Check the 15 digits on the device or its box and enter them again.",
};

export interface RejectInput {
  imei: string;
  blacklisted: boolean;
  activationLock: "on" | "off";
  waterExposure: boolean;
  repaired: Repaired;
}

/** First failing gate in documented order, or null when the device may be graded. */
export function checkRejects(input: RejectInput): { code: RejectCode; reason: string } | null {
  const gates: [boolean, RejectCode][] = [
    [input.blacklisted, "blacklisted_imei"],
    [input.activationLock === "on", "activation_lock"],
    [input.waterExposure, "water_exposure"],
    [input.repaired === "other_shop", "other_shop_repair"],
    [!isValidImei(input.imei), "invalid_imei"],
  ];
  const hit = gates.find(([failed]) => failed);
  return hit ? { code: hit[1], reason: REJECT_COPY[hit[1]] } : null;
}

// --- Estimate, confidence, band ---------------------------------------------

export function batteryGrade(health: number, s: Settings): Grade {
  if (health >= s.battery_a_min) return "A";
  if (health >= s.battery_b_min) return "B";
  if (health >= s.battery_c_min) return "C";
  return "D";
}

/** Automatic read: any failed self-check makes the function grade D (stricter than the technician). */
export function selfCheckFunctionGrade(failedChecks: number): Grade {
  return failedChecks === 0 ? "A" : "D";
}

export const CONFIDENCE_VALUE: Record<ConfidenceLevel, number> = { High: 90, Medium: 70, Low: 45 };

export function confidenceFor(
  repaired: Repaired,
  retakeCount: number,
  s: Settings,
): ConfidenceLevel {
  if (repaired === "not_sure") return "Low";
  if (retakeCount > s.photo_retake_medium) return "Medium";
  return "High";
}

/** Band shapes; a Low band at A or D is clamped to two grades (confirmed GRD-009). */
export function bandFor(estimate: Grade, confidence: ConfidenceLevel): Grade[] {
  const i = gradeIndex(estimate);
  if (estimate === "A") return ["A", "B"];
  if (estimate === "D") return ["C", "D"];
  if (confidence === "Low") return [gradeAt(i - 1), estimate, gradeAt(i + 1)];
  return [gradeAt(i - 1), estimate];
}

/** True for a contiguous run of 1–3 grades. */
export function isValidBand(band: readonly Grade[]): boolean {
  if (band.length < 1 || band.length > 3) return false;
  return band.every((g, k) => k === 0 || gradeIndex(g) === gradeIndex(band[k - 1] as Grade) + 1);
}

export interface AssessmentInput {
  batteryHealth: number;
  declaredCosmetic: Grade;
  failedChecks: number;
  repaired: Repaired;
  retakeCount: number;
}

export interface Assessment {
  estimate: Grade;
  band: Grade[];
  confidence: ConfidenceLevel;
  confidenceValue: number;
  components: { battery: Grade; cosmetic: Grade; functions: Grade };
  factors: string[];
}

export function assess(input: AssessmentInput, s: Settings): Assessment {
  const battery = batteryGrade(input.batteryHealth, s);
  const cosmetic = GRADES.includes(input.declaredCosmetic) ? input.declaredCosmetic : "B";
  const functions = selfCheckFunctionGrade(input.failedChecks);
  const estimate = worstGrade(battery, cosmetic, functions);
  const confidence = confidenceFor(input.repaired, input.retakeCount, s);

  const factors = [
    `Battery health ${input.batteryHealth}% → grade ${battery}`,
    `Condition you described → grade ${cosmetic}`,
    input.failedChecks === 0
      ? "All device checks passed → grade A"
      : `${input.failedChecks} device check${input.failedChecks === 1 ? "" : "s"} failed → grade D`,
  ];
  if (confidence === "Low") factors.push("Repair history not sure → confidence Low");
  else if (confidence === "Medium")
    factors.push(`Photos retaken ${input.retakeCount} times → confidence Medium`);

  return {
    estimate,
    band: bandFor(estimate, confidence),
    confidence,
    confidenceValue: CONFIDENCE_VALUE[confidence],
    components: { battery, cosmetic, functions },
    factors,
  };
}

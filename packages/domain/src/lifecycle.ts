// Lifecycle: price ladder and the payout state machine. docs/automations.md.txt §3 and §5.
import { diffDays } from "./business-date";
import { DomainError } from "./errors";
import { roundTo10 } from "./money";
import type { IsoDate, Settings } from "./types";

// --- Price ladder -----------------------------------------------------------

/** days_listed = business date − listed_at − reserved days. */
export function daysListed(listedAt: IsoDate, today: IsoDate, reservedDays: number): number {
  return diffDays(listedAt, today) - reservedDays;
}

/** Held days for a reserved listing: max(0, today − paid_at + 1). */
export function reservedDaysSince(paidAt: IsoDate, today: IsoDate): number {
  return Math.max(0, diffDays(paidAt, today) + 1);
}

export interface LadderInput {
  basePrice: number;
  floorPrice: number;
  daysListed: number;
  overridePrice?: number | null;
}

export interface LadderPosition {
  ladderStep: 0 | 1 | 2;
  /** The ladder price for this step (nearest ₹10, never below the floor). */
  ladderPrice: number;
  /** False when an override holds the price. */
  priceMovedByLadder: boolean;
  /** What the buyer pays: the override when set, else the ladder price. */
  effectivePrice: number;
  /** review_day reached: listing → review, device → day45_review, ops alerted. Never auto-liquidates. */
  review: boolean;
}

/**
 * Assumption: the stepped price is rounded to ₹10 first and the floor applied last, so the
 * result never drops below the floor.
 */
export function ladderPosition(input: LadderInput, s: Settings): LadderPosition {
  const step: 0 | 1 | 2 =
    input.daysListed >= s.step2_day ? 2 : input.daysListed >= s.step1_day ? 1 : 0;
  const pct = step === 2 ? s.step2_pct : step === 1 ? s.step1_pct : 0;
  const stepped = step === 0 ? input.basePrice : roundTo10(input.basePrice * (1 - pct / 100));
  const ladderPrice = Math.max(input.floorPrice, stepped);
  const override = input.overridePrice ?? null;
  return {
    ladderStep: step,
    ladderPrice,
    priceMovedByLadder: override === null,
    effectivePrice: override ?? ladderPrice,
    review: input.daysListed >= s.review_day,
  };
}

// --- Payout state machine ---------------------------------------------------

export type PayoutStatus = "due" | "pending" | "approved" | "paid" | "failed";

/** The simulated rail's failure reason (Settings.simulate_payout_failure). */
export const SIMULATED_PAYOUT_FAILURE = "Account name mismatch";

export interface AttemptResult {
  /** Status writes in order; success writes approved then paid (reconciliation reads both). */
  writes: PayoutStatus[];
  status: PayoutStatus;
  attempts: number;
  failureReason: string;
  /** True when this attempt reached the limit: open one payment_hold exception. */
  openException: boolean;
  notifications: ("payout_paid" | "payout_failed" | "payout_hold")[];
}

export function attemptPayout(
  payout: { status: PayoutStatus; attempts: number },
  transfer: { ok: true } | { ok: false; reason: string },
  s: Settings,
): AttemptResult {
  if (payout.status === "paid") {
    throw new DomainError(409, "already_paid", "This payout has already been paid.");
  }
  if (payout.status === "due") {
    throw new DomainError(409, "not_yet_due", "This payout isn't due yet.");
  }
  const attempts = payout.attempts + 1;
  if (transfer.ok) {
    return {
      writes: ["approved", "paid"],
      status: "paid",
      attempts,
      failureReason: "",
      openException: false,
      notifications: ["payout_paid"],
    };
  }
  const failed = attempts >= s.payout_max_attempts;
  const status: PayoutStatus = failed ? "failed" : "approved";
  return {
    writes: [status],
    status,
    attempts,
    failureReason: transfer.reason,
    // Opened once: a retry of an already-failed payout keeps the existing exception.
    openException: failed && payout.status !== "failed",
    notifications: failed && payout.status !== "failed" ? ["payout_failed", "payout_hold"] : [],
  };
}

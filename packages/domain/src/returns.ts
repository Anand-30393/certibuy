// Returns: window, eligibility, reason/outcome matrix, refund maths (B-09, O-07).
import { addDays } from "./business-date";
import { DomainError } from "./errors";
import type { IsoDate, Settings } from "./types";

export type ReturnReason = "not_as_graded" | "dead_on_arrival" | "buyer_changed_mind";
export type ReturnOutcome =
  "faulty" | "as_shipped" | "doa_confirmed" | "doa_replacement" | "changed_mind";

export const OUTCOMES_FOR: Record<ReturnReason, readonly ReturnOutcome[]> = {
  not_as_graded: ["faulty", "as_shipped"],
  dead_on_arrival: ["doa_confirmed", "doa_replacement", "as_shipped"],
  buyer_changed_mind: ["changed_mind"],
};

/** The window starts at delivery (D3). */
export function returnWindowClosesAt(deliveredAt: IsoDate, s: Settings): IsoDate {
  return addDays(deliveredAt, s.return_window_days);
}

/** The closing day itself is inside the window (confirmed RET-002). */
export function insideReturnWindow(closesAt: IsoDate, today: IsoDate): boolean {
  return today <= closesAt;
}

/** Preconditions for raising a return; throws a DomainError the UI can show. */
export function assertCanRaiseReturn(input: {
  orderStatus: string;
  closesAt: IsoDate | null;
  today: IsoDate;
  hasOpenReturn: boolean;
}): void {
  // A settled order has had its escrow released, so its window is over even if the business
  // clock was moved back afterwards (a refund would then pay out twice).
  if (input.orderStatus === "settled") {
    throw new DomainError(409, "window_closed", "The return window for this order has closed.");
  }
  if (input.orderStatus !== "delivered") {
    throw new DomainError(
      409,
      "not_delivered",
      "You can raise a return once the order is delivered.",
    );
  }
  if (input.hasOpenReturn) {
    throw new DomainError(409, "return_open", "There is already an open return for this order.");
  }
  if (input.closesAt === null || !insideReturnWindow(input.closesAt, input.today)) {
    throw new DomainError(409, "window_closed", "The return window for this order has closed.");
  }
}

/** Estimate shown before submitting: change of mind loses change_mind_fee, otherwise full. */
export function estimateRefund(
  reason: ReturnReason,
  total: number,
  s: Settings,
): { original: number; deduction: number; refund: number } {
  const deduction = reason === "buyer_changed_mind" ? Math.min(s.change_mind_fee, total) : 0;
  return { original: total, deduction, refund: total - deduction };
}

export interface Resolution {
  deduction: number;
  deductionLabel: "return_logistics" | "shipping_charges" | null;
  refund: number;
  escrowTx: "refund_full" | "refund_partial" | null;
  escrowStatus: "refunded_full" | "refunded_partial" | "held_replacement";
  orderStatus: "refunded" | "replaced";
  /** Healthy devices go back on the shelf at day 0; faulty ones go to refurbishment. */
  deviceAction: "relist" | "refurbish";
  replacementAllocated: boolean;
}

/** Ops resolution: the outcome must be one the reason allows. Refund base = order total. */
export function resolveReturn(
  input: { reason: ReturnReason; outcome: ReturnOutcome; total: number },
  s: Settings,
): Resolution {
  if (!OUTCOMES_FOR[input.reason].includes(input.outcome)) {
    throw new DomainError(
      400,
      "outcome_not_allowed",
      "That outcome isn't allowed for this return reason.",
    );
  }
  const partial = (deduction: number, label: Resolution["deductionLabel"]): Resolution => ({
    deduction,
    deductionLabel: label,
    refund: input.total - deduction,
    escrowTx: "refund_partial",
    escrowStatus: "refunded_partial",
    orderStatus: "refunded",
    deviceAction: "relist",
    replacementAllocated: false,
  });
  switch (input.outcome) {
    case "faulty":
    case "doa_confirmed":
      return {
        deduction: 0,
        deductionLabel: null,
        refund: input.total,
        escrowTx: "refund_full",
        escrowStatus: "refunded_full",
        orderStatus: "refunded",
        deviceAction: "refurbish",
        replacementAllocated: false,
      };
    case "as_shipped":
      return partial(Math.min(s.return_logistics_charge, input.total), "return_logistics");
    case "changed_mind":
      return partial(Math.min(s.change_mind_fee, input.total), "shipping_charges");
    case "doa_replacement":
      return {
        deduction: 0,
        deductionLabel: null,
        refund: 0,
        escrowTx: null,
        escrowStatus: "held_replacement",
        orderStatus: "replaced",
        deviceAction: "refurbish",
        replacementAllocated: true,
      };
  }
}

/** Raising a return increments the device and buyer counters (F16). */
export function incrementReturnCounters(counts: { device: number; buyer: number }) {
  return { device: counts.device + 1, buyer: counts.buyer + 1 };
}

// --- DOA replacement (open item 8, approved 17 November 2026) ----------------------------------

export interface ReplacementCandidate {
  listingId: string;
  deviceModelId: string;
  grade: "A" | "B" | "C" | "D";
  price: number;
  status: string;
}

const GRADE_ORDER = ["A", "B", "C", "D"] as const;

/**
 * Pick a replacement unit: same model (and storage — one DeviceModel row), same grade or better,
 * currently listed. Default is the cheapest; null means no replacement can be offered and the
 * return must be resolved as "DOA confirmed" (full refund) instead.
 */
export function pickReplacement(
  original: { deviceModelId: string; grade: "A" | "B" | "C" | "D" },
  candidates: readonly ReplacementCandidate[],
): ReplacementCandidate | null {
  const limit = GRADE_ORDER.indexOf(original.grade);
  const eligible = candidates.filter(
    (c) =>
      c.status === "active" &&
      c.deviceModelId === original.deviceModelId &&
      GRADE_ORDER.indexOf(c.grade) <= limit,
  );
  eligible.sort((a, b) => a.price - b.price || a.listingId.localeCompare(b.listingId));
  return eligible[0] ?? null;
}

/** One replacement per order: a second DOA can only be refunded (or resolved as shipped). */
export function replacementAllowed(order: { replacementDeviceId: string | null }): boolean {
  return order.replacementDeviceId === null;
}

// Buying: order totals, checkout hold, pre-dispatch cancellation (F7).
import { DomainError } from "./errors";
import { percentOf } from "./money";
import type { Settings } from "./types";

export type OrderStatus =
  | "pending"
  | "paid"
  | "dispatched"
  | "in_transit"
  | "delivered"
  | "settled"
  | "refunded"
  | "replaced"
  | "cancelled";

export interface OrderTotalInput {
  currentPrice: number;
  overridePrice?: number | null;
  /** 0 for grade-D listings. */
  warrantyMonths: number;
  warrantyAddon: boolean;
}

/** Price from the listing (override first) plus the add-on when allowed. */
export function orderTotal(
  input: OrderTotalInput,
  s: Settings,
): { devicePrice: number; warrantyAddonAmount: number; total: number } {
  const devicePrice = input.overridePrice ?? input.currentPrice;
  if (input.warrantyAddon && input.warrantyMonths <= 0) {
    // Confirmed ORD-003: requesting the add-on on a grade-D (0-month) listing is rejected.
    throw new DomainError(
      400,
      "warranty_addon_unavailable",
      "The warranty add-on isn't available for this device.",
    );
  }
  const warrantyAddonAmount = input.warrantyAddon
    ? percentOf(devicePrice, s.warranty_addon_pct)
    : 0;
  return { devicePrice, warrantyAddonAmount, total: devicePrice + warrantyAddonAmount };
}

/** When an async (pending) payment's listing hold expires. */
export function holdExpiresAt(createdAt: Date, s: Settings): Date {
  return new Date(createdAt.getTime() + s.checkout_hold_minutes * 60_000);
}

export interface CancellationResult {
  already: boolean;
  orderStatus: "cancelled";
  escrowTx: "refund_full" | "refund_partial" | null;
  escrowStatus: "refunded_full" | "refunded_partial" | null;
  refund: number;
  deduction: number;
  listingStatus: "active";
  deviceStatus: "listed";
  notification: "order_cancelled" | null;
  /** A cancellation never reverses a seller payout. */
  sellerPayoutsAffected: false;
}

/** Cancel before dispatch (F7). Paid orders get total − cancel_fee (0 by default = full refund). */
export function cancelOrder(
  input: { orderStatus: OrderStatus; total: number },
  s: Settings,
): CancellationResult {
  const common = {
    orderStatus: "cancelled" as const,
    listingStatus: "active" as const,
    deviceStatus: "listed" as const,
    sellerPayoutsAffected: false as const,
  };
  if (input.orderStatus === "cancelled") {
    return {
      ...common,
      already: true,
      escrowTx: null,
      escrowStatus: null,
      refund: 0,
      deduction: 0,
      notification: null,
    };
  }
  if (input.orderStatus === "pending") {
    return {
      ...common,
      already: false,
      escrowTx: null,
      escrowStatus: null,
      refund: 0,
      deduction: 0,
      notification: "order_cancelled",
    };
  }
  if (input.orderStatus !== "paid") {
    throw new DomainError(
      409,
      "already_dispatched",
      "This order has already been dispatched. You can raise a return after delivery.",
    );
  }
  const deduction = Math.min(Math.max(0, s.cancel_fee), input.total);
  const full = deduction === 0;
  return {
    ...common,
    already: false,
    escrowTx: full ? "refund_full" : "refund_partial",
    escrowStatus: full ? "refunded_full" : "refunded_partial",
    refund: input.total - deduction,
    deduction,
    notification: "order_cancelled",
  };
}

// Custody: payout plan at handover, balance promotion, listing creation (F9, F10, D4).
import { addDays } from "./business-date";
import { DomainError } from "./errors";
import { gradePrice } from "./pricing";
import type { Grade, IsoDate, ModelPrices, Settings } from "./types";

export type PayoutType = "instant_cash_full" | "advance" | "balance" | "mismatch_fee";
export type PayoutTrigger =
  "custody_handover" | "buyer_paid_escrow" | "day_21_unsold" | "inspection_mismatch";

export interface PlannedPayout {
  type: PayoutType;
  amount: number;
  trigger: PayoutTrigger | null;
  status: "pending" | "due";
  dueOn?: IsoDate;
}

/** Advance/balance split; the balance absorbs rounding (confirmed PAY-003). */
export function advanceSplit(
  guaranteed: number,
  s: Settings,
): { advance: number; balance: number } {
  const advance = Math.round((guaranteed * s.advance_pct) / 100);
  return { advance, balance: guaranteed - advance };
}

export function balanceDueOn(custodyAt: IsoDate, s: Settings): IsoDate {
  return addDays(custodyAt, s.balance_day);
}

/** Payouts created at handover. Sell For More also records the balance as due (D4). */
export function payoutPlan(
  input:
    | { option: "instant_cash"; instantCashAmount: number }
    | { option: "sell_for_more"; guaranteed: number; custodyAt: IsoDate },
  s: Settings,
): PlannedPayout[] {
  if (input.option === "instant_cash") {
    return [
      {
        type: "instant_cash_full",
        amount: input.instantCashAmount,
        trigger: "custody_handover",
        status: "pending",
      },
    ];
  }
  const { advance, balance } = advanceSplit(input.guaranteed, s);
  return [
    { type: "advance", amount: advance, trigger: "custody_handover", status: "pending" },
    {
      type: "balance",
      amount: balance,
      trigger: null,
      status: "due",
      dueOn: balanceDueOn(input.custodyAt, s),
    },
  ];
}

export type BalanceStatus = "due" | "pending" | "approved" | "paid" | "failed";

/** A due balance becomes payable when the buyer pays or on its day-21 date, whichever is first. */
export function promoteBalance(
  input: { status: BalanceStatus; custodyAt: IsoDate; today: IsoDate; buyerPaid: boolean },
  s: Settings,
): { status: BalanceStatus; trigger: PayoutTrigger | null } {
  if (input.status !== "due") return { status: input.status, trigger: null };
  if (input.buyerPaid) return { status: "pending", trigger: "buyer_paid_escrow" };
  if (input.today >= balanceDueOn(input.custodyAt, s)) {
    return { status: "pending", trigger: "day_21_unsold" };
  }
  return { status: "due", trigger: null };
}

export type ListingEvent = "handover" | "refurbished" | "relist";

export type ListingPlan =
  | { listingCreated: false; deviceStatus: "in_refurbishment" }
  | {
      listingCreated: true;
      deviceStatus: "listed";
      basePrice: number;
      floorPrice: number;
      warrantyMonths: number;
      warrantyAddonOffered: boolean;
      ladderStep: 0;
    };

/**
 * Listing rules. Floor = the model's B2B floor for every listing (F10). Grade D is never
 * listed at handover; after refurbishment, or as a healthy return, it lists with no warranty (F9).
 */
export function planListing(
  event: ListingEvent,
  finalGrade: Grade,
  model: ModelPrices,
  s: Settings,
): ListingPlan {
  if (event === "handover" && finalGrade === "D") {
    return { listingCreated: false, deviceStatus: "in_refurbishment" };
  }
  const floor = model.b2b_floor_price;
  if (floor == null || floor <= 0) {
    throw new DomainError(
      400,
      "floor_missing",
      "This model needs a B2B floor price before it can be listed.",
    );
  }
  const warrantyMonths = finalGrade === "D" ? 0 : s.warranty_months;
  return {
    listingCreated: true,
    deviceStatus: "listed",
    basePrice: gradePrice(model, finalGrade, s),
    floorPrice: floor,
    warrantyMonths,
    warrantyAddonOffered: warrantyMonths > 0,
    ladderStep: 0,
  };
}

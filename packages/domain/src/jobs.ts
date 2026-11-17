// Pure rules used by the daily job (docs/automations.md.txt §3). All comparisons are on
// yyyy-mm-dd business dates, never timestamps.
import { diffDays } from "./business-date";
import type { IsoDate } from "./types";

/** Step 4: escrow is released once the return window has closed (the closing day is still inside). */
export function escrowReleasable(o: {
  orderStatus: string;
  escrowStatus: string | null;
  closesAt: IsoDate | null;
  today: IsoDate;
  hasOpenReturn: boolean;
}): boolean {
  return (
    o.orderStatus === "delivered" &&
    o.escrowStatus === "hold" &&
    o.closesAt !== null &&
    o.today > o.closesAt &&
    !o.hasOpenReturn
  );
}

/** Step 5: an offer is expired the day after its expiry date (valid through that day). */
export function offerExpired(expiresAt: IsoDate, today: IsoDate): boolean {
  return today > expiresAt;
}

/** Step 6: a still-booked slot whose date has passed is a no-show. */
export function isNoShow(booking: { status: string; date: IsoDate }, today: IsoDate): boolean {
  return booking.status === "booked" && booking.date < today;
}

/** Step 7: a reminder is due when the deadline is today or within `windowDays` ahead. */
export function reminderDue(deadline: IsoDate, today: IsoDate, windowDays: number): boolean {
  const left = diffDays(today, deadline);
  return left >= 0 && left <= windowDays;
}

/**
 * Reserved days after a reservation ends: the days already held plus this reservation's days
 * (reserved day and release day both count). A clock moved back never makes it negative.
 */
export function heldDays(current: number, reservedSince: IsoDate, today: IsoDate): number {
  return current + Math.max(0, diffDays(reservedSince, today)) + 1;
}

/** Step 1: the ladder only ever steps down; a relisted device starts again at step 0. */
export function ladderAdvances(currentStep: number, nextStep: number): boolean {
  return nextStep > currentStep;
}

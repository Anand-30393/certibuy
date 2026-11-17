// Listing reservation bookkeeping shared by checkout, cancellation and hold expiry.
import { heldDays } from "@certibuy/domain";
import { fromIsoDate, toIsoDate } from "@certibuy/db";
import type { Tx } from "./support";

/** Reserve an active listing for a checkout; false when someone else got it (or the price moved). */
export async function reserveListing(
  tx: Tx,
  listing: { id: string; current_price: number; override_price: number | null },
  day: string,
): Promise<boolean> {
  const moved = await tx.listing.updateMany({
    where: {
      id: listing.id,
      status: "active",
      current_price: listing.current_price,
      override_price: listing.override_price,
    },
    data: { status: "reserved", reserved_since: fromIsoDate(day) },
  });
  return moved.count === 1;
}

/** Put a reserved listing back on the shelf, adding this reservation's days (ladder skips them). */
export async function releaseReservation(tx: Tx, listingId: string, day: string): Promise<void> {
  const l = await tx.listing.findUnique({ where: { id: listingId } });
  if (!l || l.status !== "reserved") return;
  const since = l.reserved_since ? toIsoDate(l.reserved_since) : day;
  await tx.listing.updateMany({
    where: { id: listingId, status: "reserved" },
    data: {
      status: "active",
      reserved_days: heldDays(l.reserved_days, since, day),
      reserved_since: null,
    },
  });
}

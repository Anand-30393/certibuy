// Multi-device cart (Option A, approved 17 November 2026): every device is unique, quantity is
// always 1, and each cart line becomes its own order with its own escrow, tracking and returns.

export interface CartLine {
  listingId: string;
  warrantyAddon: boolean;
}

export interface CartAvailability {
  listingId: string;
  status: string;
  /** Owned by CertiBuy and currently listed for sale. */
  available: boolean;
}

/**
 * Normalise a cart: drop duplicate listings (a device can only be bought once) and split the
 * lines into purchasable ones and ones to remove (with the reason shown to the buyer).
 */
export function partitionCart(
  lines: readonly CartLine[],
  availability: readonly CartAvailability[],
): { purchasable: CartLine[]; removed: { listingId: string; reason: string }[] } {
  const seen = new Set<string>();
  const purchasable: CartLine[] = [];
  const removed: { listingId: string; reason: string }[] = [];
  for (const line of lines) {
    if (seen.has(line.listingId)) continue;
    seen.add(line.listingId);
    const a = availability.find((x) => x.listingId === line.listingId);
    if (a?.available) purchasable.push(line);
    else removed.push({ listingId: line.listingId, reason: "This device is no longer available." });
  }
  return { purchasable, removed };
}

/** Indian mobile: 10 digits starting 6–9, with an optional +91 / 91 prefix normalised away. */
export function normaliseIndianMobile(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "").replace(/^\+?91(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

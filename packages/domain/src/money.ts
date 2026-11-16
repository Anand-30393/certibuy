// Money is an integer number of rupees, formatted en-IN with no paise (CLAUDE.md §6).

const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** ₹1,32,000 */
export function formatInr(amount: number): string {
  return `₹${INR.format(Math.round(amount))}`;
}

/** Round to the nearest ₹10 (price ladder). */
export function roundTo10(amount: number): number {
  return Math.round(amount / 10) * 10;
}

/** `pct` percent of `amount`, rounded to whole rupees. */
export function percentOf(amount: number, pct: number): number {
  return Math.round((amount * pct) / 100);
}

// One source of label and tone for every enum shown to a user (CLAUDE.md §2.6).
// Extended per phase as screens start showing more statuses.

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
export interface StatusStyle {
  label: string;
  tone: Tone;
}

export const STATUSES = {
  app_role: {
    customer: { label: "Customer", tone: "neutral" },
    technician: { label: "Technician", tone: "info" },
    ops: { label: "Operations", tone: "info" },
  },
  active_mode: {
    buyer: { label: "Buying", tone: "neutral" },
    seller: { label: "Selling", tone: "neutral" },
  },
  submission: {
    draft: { label: "In progress", tone: "neutral" },
    graded: { label: "Offer ready", tone: "info" },
    offer_accepted: { label: "Book a hub slot", tone: "warning" },
    scheduled: { label: "Hub visit booked", tone: "info" },
    inspected: { label: "Inspected", tone: "info" },
    accepted: { label: "Accepted at the counter", tone: "success" },
    rejected: { label: "Not accepted", tone: "danger" },
    abandoned: { label: "Closed", tone: "neutral" },
  },
  offer: {
    active: { label: "Active", tone: "info" },
    accepted: { label: "Accepted", tone: "success" },
    declined: { label: "Declined", tone: "neutral" },
    expired: { label: "Expired", tone: "warning" },
  },
  booking: {
    booked: { label: "Booked", tone: "info" },
    completed: { label: "Completed", tone: "success" },
    cancelled: { label: "Cancelled", tone: "neutral" },
    no_show: { label: "Missed", tone: "warning" },
  },
  payout_status: {
    due: { label: "Scheduled", tone: "neutral" },
    pending: { label: "Processing", tone: "info" },
    approved: { label: "Processing", tone: "info" },
    paid: { label: "Paid", tone: "success" },
    failed: { label: "On hold", tone: "danger" },
  },
  payout_type: {
    instant_cash_full: { label: "Instant Cash", tone: "neutral" },
    advance: { label: "Advance", tone: "neutral" },
    balance: { label: "Balance", tone: "neutral" },
    mismatch_fee: { label: "Inspection mismatch fee", tone: "warning" },
  },
  payout_option: {
    instant_cash: { label: "Instant Cash", tone: "neutral" },
    sell_for_more: { label: "Sell For More", tone: "neutral" },
  },
  confidence: {
    High: { label: "High confidence", tone: "success" },
    Medium: { label: "Medium confidence", tone: "warning" },
    Low: { label: "Low confidence", tone: "danger" },
  },
  integration: {
    simulated: { label: "Simulated", tone: "warning" },
    live: { label: "Live", tone: "success" },
  },
} as const satisfies Record<string, Record<string, StatusStyle>>;

export type StatusGroup = keyof typeof STATUSES;

/** Label + tone for an enum value; unknown values fall back to a neutral, readable label. */
export function statusStyle(group: StatusGroup, value: string): StatusStyle {
  const entry = (STATUSES[group] as Record<string, StatusStyle>)[value];
  return entry ?? { label: value.replace(/_/g, " "), tone: "neutral" };
}

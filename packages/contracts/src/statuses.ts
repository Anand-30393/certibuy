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
  verdict: {
    inside: { label: "Inside the quoted range", tone: "success" },
    one_below: { label: "One grade below", tone: "warning" },
    two_below: { label: "Two or more grades below", tone: "danger" },
  },
  seller_decision: {
    pending: { label: "Waiting for the seller", tone: "warning" },
    accepted: { label: "Accepted", tone: "success" },
    declined: { label: "Declined", tone: "neutral" },
    fee_paid: { label: "Mismatch fee paid", tone: "neutral" },
    fee_due: { label: "Mismatch fee due", tone: "warning" },
  },
  device: {
    in_refurbishment: { label: "In refurbishment", tone: "warning" },
    listed: { label: "Listed", tone: "success" },
    day45_review: { label: "Day-45 review", tone: "warning" },
    reserved: { label: "Reserved", tone: "info" },
    shipped: { label: "Shipped", tone: "info" },
    delivered: { label: "Delivered", tone: "info" },
    settled: { label: "Settled", tone: "success" },
    returned: { label: "Returned", tone: "warning" },
    liquidated: { label: "Liquidated", tone: "neutral" },
  },
  order: {
    pending: { label: "Awaiting payment", tone: "warning" },
    paid: { label: "Paid — preparing dispatch", tone: "info" },
    dispatched: { label: "Dispatched", tone: "info" },
    in_transit: { label: "In transit", tone: "info" },
    delivered: { label: "Delivered", tone: "success" },
    settled: { label: "Complete", tone: "success" },
    refunded: { label: "Refunded", tone: "neutral" },
    replaced: { label: "Replacement on the way", tone: "info" },
    cancelled: { label: "Cancelled", tone: "neutral" },
  },
  escrow: {
    hold: { label: "Held safely in escrow", tone: "info" },
    released: { label: "Released", tone: "success" },
    refunded_full: { label: "Refunded in full", tone: "neutral" },
    refunded_partial: { label: "Partly refunded", tone: "neutral" },
    held_replacement: { label: "Held for your replacement", tone: "info" },
  },
  return_status: {
    awaiting_reinspection: { label: "Waiting for re-inspection", tone: "warning" },
    awaiting_decision: { label: "Re-inspected — decision pending", tone: "warning" },
    resolved: { label: "Resolved", tone: "success" },
  },
  return_outcome: {
    faulty: { label: "Faulty — full refund", tone: "success" },
    as_shipped: { label: "As shipped — refund less return logistics", tone: "neutral" },
    doa_confirmed: { label: "Dead on arrival — full refund", tone: "success" },
    doa_replacement: { label: "Dead on arrival — replacement", tone: "success" },
    changed_mind: { label: "Changed mind — refund less shipping charges", tone: "neutral" },
  },
  return_reason: {
    not_as_graded: { label: "Not as graded", tone: "neutral" },
    dead_on_arrival: { label: "Dead on arrival", tone: "neutral" },
    buyer_changed_mind: { label: "Changed mind", tone: "neutral" },
  },
  listing: {
    active: { label: "Listed", tone: "success" },
    reserved: { label: "Reserved", tone: "info" },
    sold: { label: "Sold", tone: "success" },
    review: { label: "Waiting for review", tone: "warning" },
    liquidated: { label: "Liquidated", tone: "neutral" },
    inactive: { label: "Inactive", tone: "neutral" },
  },
  exception_type: {
    return: { label: "Return", tone: "info" },
    failed_inspection: { label: "Failed inspection", tone: "warning" },
    grade_dispute: { label: "Grade dispute", tone: "warning" },
    payment_hold: { label: "Payout on hold", tone: "danger" },
  },
  case_status: {
    open: { label: "Open", tone: "warning" },
    resolved: { label: "Resolved", tone: "success" },
  },
  support_topic: {
    selling_device: { label: "Selling a device", tone: "neutral" },
    order_delivery: { label: "Order or delivery", tone: "neutral" },
    return_refund: { label: "Return or refund", tone: "neutral" },
    payments: { label: "Payments", tone: "neutral" },
    other: { label: "Something else", tone: "neutral" },
  },
  invitation: {
    pending: { label: "Invited", tone: "warning" },
    accepted: { label: "Accepted", tone: "success" },
    expired: { label: "Expired", tone: "neutral" },
    revoked: { label: "Revoked", tone: "neutral" },
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

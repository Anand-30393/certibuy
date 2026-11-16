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

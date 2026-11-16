// Small shared display primitives: money, status chips, grade chips, empty panels.
import { statusStyle, type StatusGroup } from "@certibuy/contracts";
import { formatInr } from "@certibuy/domain";
import type { ReactNode } from "react";

export function Money({ amount, large }: { amount: number; large?: boolean }) {
  return <span className={large ? "money money-lg" : "money"}>{formatInr(amount)}</span>;
}

/** Label + tone from the single status vocabulary (CLAUDE.md §2.6). Never a raw enum. */
export function StatusChip({ group, value }: { group: StatusGroup; value: string }) {
  const s = statusStyle(group, value);
  return <span className={`chip tone-${s.tone}`}>{s.label}</span>;
}

export function GradeChip({ grade }: { grade: string }) {
  return (
    <span className={`grade grade-${grade}`} aria-label={`Grade ${grade}`}>
      {grade}
    </span>
  );
}

export function EmptyPanel({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="surface empty-panel">
      <p className="field-label">{title}</p>
      {children}
    </div>
  );
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: iso.length === 10 ? "UTC" : "Asia/Kolkata",
  }).format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso));
}

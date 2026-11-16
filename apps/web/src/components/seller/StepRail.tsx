const STEPS = [
  ["details", "Details"],
  ["photos", "Photos"],
  ["diagnostics", "Checks"],
  ["result", "Result"],
  ["offer", "Offer"],
  ["confirm", "Confirm"],
  ["hub", "Hub"],
] as const;

export type Step = (typeof STEPS)[number][0];

/** Wizard progress (S-03 … S-12). */
export default function StepRail({ current }: { current: Step }) {
  const at = STEPS.findIndex(([k]) => k === current);
  return (
    <ol className="step-rail" aria-label="Selling steps">
      {STEPS.map(([key, label], i) => (
        <li
          key={key}
          className={i < at ? "done" : i === at ? "current" : ""}
          aria-current={i === at ? "step" : undefined}
        >
          {label}
        </li>
      ))}
    </ol>
  );
}

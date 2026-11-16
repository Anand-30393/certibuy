"use client";

// S-05: seller-declared checks (the "scan" is simulated — audit S-05) then grading (S-06).
import { DIAGNOSTIC_CHECKS, type SubmissionViewT } from "@certibuy/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { command } from "@/lib/api";

export default function DiagnosticsStep({ sub }: { sub: SubmissionViewT }) {
  const router = useRouter();
  const [checks, setChecks] = useState<Record<string, "pass" | "fail">>(() => ({
    ...(sub.diagnostics.checks as Record<string, "pass" | "fail">),
  }));
  const [battery, setBattery] = useState<string>(String(sub.diagnostics.batteryHealth ?? ""));
  const [phase, setPhase] = useState<"form" | "scanning">("form");
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const health = Number(battery);
    if (DIAGNOSTIC_CHECKS.some((c) => !checks[c.key])) return setError("Answer every check.");
    if (!Number.isInteger(health) || health < 50 || health > 100) {
      return setError(
        "Enter battery health between 50 and 100 (Settings → Battery on most phones).",
      );
    }
    setError(null);
    setPhase("scanning");
    try {
      await command("saveDiagnostics", { submissionId: sub.id, checks, batteryHealth: health });
      const graded = await command<{ next: string }>("gradeSubmission", { submissionId: sub.id });
      router.push(graded.next);
    } catch (e) {
      setPhase("form");
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    }
  }

  if (phase === "scanning") {
    return (
      <div className="surface empty-panel" role="status" aria-live="polite">
        <p className="field-label">Checking your answers and photos…</p>
        <p className="meta">Simulated device scan — this takes a moment.</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <ul className="list">
        {DIAGNOSTIC_CHECKS.map((c) => (
          <li key={c.key} className="surface list-row">
            <span>{c.label}</span>
            <div className="chip-row" role="group" aria-label={c.label}>
              {(["pass", "fail"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className="pill"
                  aria-pressed={checks[c.key] === v}
                  onClick={() => setChecks((s) => ({ ...s, [c.key]: v }))}
                >
                  {v === "pass"
                    ? c.key === "activation_lock"
                      ? "Off"
                      : "Works"
                    : c.key === "activation_lock"
                      ? "Still on"
                      : "Problem"}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <label className="field">
        <span className="field-label">Battery health (%)</span>
        <input
          inputMode="numeric"
          value={battery}
          onChange={(e) => setBattery(e.target.value.replace(/\D/g, ""))}
          maxLength={3}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="sticky-footer">
        <button type="button" className="button primary" onClick={run}>
          Get my offer
        </button>
      </div>
    </div>
  );
}

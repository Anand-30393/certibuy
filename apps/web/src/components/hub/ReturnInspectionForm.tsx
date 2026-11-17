"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { command } from "@/lib/api";

const RECOMMENDATIONS = [
  ["faulty", "Faulty — not as graded"],
  ["as_shipped", "As shipped — matches the report"],
  ["doa_confirmed", "Dead on arrival confirmed"],
] as const;

export default function ReturnInspectionForm({ returnId }: { returnId: string }) {
  const router = useRouter();
  const [rec, setRec] = useState<(typeof RECOMMENDATIONS)[number][0] | null>(null);
  const [battery, setBattery] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!rec) return setError("Choose a recommendation.");
    setBusy(true);
    setError(null);
    try {
      await command("returnInspection", {
        returnId,
        recommendation: rec,
        ...(battery ? { batteryHealth: Number(battery) } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface panel stack">
      <h2>Re-inspection</h2>
      <div className="chip-row">
        {RECOMMENDATIONS.map(([v, label]) => (
          <button
            key={v}
            type="button"
            className="pill"
            aria-pressed={rec === v}
            onClick={() => setRec(v)}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="field">
        <span className="field-label">Battery health (%) — optional</span>
        <input
          inputMode="numeric"
          maxLength={3}
          value={battery}
          onChange={(e) => setBattery(e.target.value.replace(/\D/g, ""))}
        />
      </label>
      <label className="field">
        <span className="field-label">Notes</span>
        <textarea
          rows={3}
          maxLength={500}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="button primary" disabled={busy || !rec} onClick={submit}>
        Record re-inspection
      </button>
    </div>
  );
}

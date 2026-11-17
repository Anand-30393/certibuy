"use client";

import type { ReturnOptionsView } from "@certibuy/contracts";
import { formatInr } from "@certibuy/domain";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { z } from "zod";
import { command } from "@/lib/api";

type Option = z.infer<typeof ReturnOptionsView>["options"][number];

export default function ReturnForm(props: {
  orderId: string;
  options: Option[];
  replacementAllowed: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState<Option["reason"] | null>(null);
  const [pref, setPref] = useState<"refund" | "replacement">("refund");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = props.options.find((o) => o.reason === reason);

  async function submit() {
    if (!reason) return setError("Choose a reason.");
    setBusy(true);
    setError(null);
    try {
      await command("raiseReturn", {
        orderId: props.orderId,
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(reason === "dead_on_arrival" ? { doaPreference: pref } : {}),
      });
      router.push(`/shop/orders/${props.orderId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <fieldset className="field">
        <legend className="field-label">Why are you returning it?</legend>
        <div className="tile-grid">
          {props.options.map((o) => (
            <button
              key={o.reason}
              type="button"
              className="tile surface"
              aria-pressed={reason === o.reason}
              onClick={() => setReason(o.reason)}
            >
              <span className="tile-title">{o.label}</span>
              <span className="meta">
                Estimated refund {formatInr(o.refund)}
                {o.deduction ? ` (${formatInr(o.deduction)} shipping charges)` : ""}
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      {reason === "dead_on_arrival" && (
        <fieldset className="field">
          <legend className="field-label">If we confirm it was dead on arrival</legend>
          <div className="chip-row">
            <button
              type="button"
              className="pill"
              aria-pressed={pref === "refund"}
              onClick={() => setPref("refund")}
            >
              Full refund
            </button>
            <button
              type="button"
              className="pill"
              aria-pressed={pref === "replacement"}
              disabled={!props.replacementAllowed}
              onClick={() => setPref("replacement")}
            >
              Replacement unit
            </button>
          </div>
          {!props.replacementAllowed && (
            <p className="meta">This order has already had a replacement.</p>
          )}
        </fieldset>
      )}
      <label className="field">
        <span className="field-label">Tell us what happened (optional)</span>
        <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {chosen && (
        <p>
          Estimated refund <strong>{formatInr(chosen.refund)}</strong> after re-inspection at our
          hub. The final outcome depends on what our technician finds.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="button primary" disabled={busy || !reason} onClick={submit}>
        {busy ? "Submitting…" : "Submit return"}
      </button>
    </div>
  );
}

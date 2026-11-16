"use client";

import type { SubmissionViewT } from "@certibuy/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDate } from "@/components/common/ui";
import { command } from "@/lib/api";

export default function HubBooking({ sub }: { sub: SubmissionViewT }) {
  const router = useRouter();
  const [hubId, setHubId] = useState(sub.booking?.hubId ?? sub.hubs[0]?.id ?? "");
  const hub = sub.hubs.find((h) => h.id === hubId);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const day = hub?.days.find((d) => d.date === date);

  async function book() {
    if (!hub || !date || !slot) return setError("Choose a hub, a day and a time.");
    setBusy(true);
    setError(null);
    try {
      const r = await command<{ next: string }>("bookInspection", {
        submissionId: sub.id,
        hubId: hub.id,
        date,
        slot,
      });
      router.push(r.next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  if (sub.hubs.length === 0)
    return <p>No hubs are taking bookings right now. Please check back soon.</p>;

  return (
    <div className="stack">
      <fieldset className="field">
        <legend className="field-label">Hub</legend>
        <div className="tile-grid">
          {sub.hubs.map((h) => (
            <button
              key={h.id}
              type="button"
              className="tile surface"
              aria-pressed={h.id === hubId}
              onClick={() => {
                setHubId(h.id);
                setDate(null);
                setSlot(null);
              }}
            >
              <span className="tile-title">{h.name}</span>
              <span className="meta">
                {h.address}, {h.city}
                {h.distanceKm !== null ? ` · ${h.distanceKm} km` : ""}
              </span>
              <span className="meta">{h.type === "flagship" ? "CertiBuy hub" : "Partner hub"}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {hub && (
        <fieldset className="field">
          <legend className="field-label">Day</legend>
          <div className="chip-row">
            {hub.days.map((d) => (
              <button
                key={d.date}
                type="button"
                className="pill"
                disabled={d.remaining === 0}
                aria-pressed={d.date === date}
                onClick={() => {
                  setDate(d.date);
                  setSlot(null);
                }}
              >
                {formatDate(d.date)} {d.remaining === 0 ? "· full" : ""}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {day && (
        <fieldset className="field">
          <legend className="field-label">Time</legend>
          <div className="chip-row">
            {day.slots.map((s) => (
              <button
                key={s}
                type="button"
                className="pill"
                aria-pressed={s === slot}
                onClick={() => setSlot(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <p className="meta">Bring the device, its charger if you have it, and a photo ID.</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="sticky-footer">
        <button type="button" className="button primary" disabled={busy || !slot} onClick={book}>
          {busy ? "Booking…" : "Confirm booking"}
        </button>
      </div>
    </div>
  );
}

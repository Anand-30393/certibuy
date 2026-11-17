"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { command } from "@/lib/api";

type Result = { counts?: Record<string, number>; businessDate?: string; simDayOffset?: number };

export default function JobsPanel(props: {
  demo: boolean;
  simulatePayoutFailure: boolean;
  pendingEmails: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(
    label: string,
    name: string,
    body: Record<string, unknown> = {},
    confirmText?: string,
  ) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(label);
    setError(null);
    setResult(null);
    try {
      const r = await command<Result>(name, body);
      const counts = Object.entries(r.counts ?? {})
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k} ${v}`)
        .join(" · ");
      setResult(
        `${label}: ${counts || "nothing to do"}${r.businessDate ? ` (business date ${r.businessDate})` : ""}`,
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const button = (
    label: string,
    name: string,
    body?: Record<string, unknown>,
    confirmText?: string,
  ) => (
    <button
      type="button"
      className="button"
      disabled={busy !== null}
      onClick={() => run(label, name, body, confirmText)}
    >
      {busy === label ? "Running…" : label}
    </button>
  );

  return (
    <div className="stack">
      <div className="surface panel stack">
        <h2>Run jobs</h2>
        <p className="meta">
          Every job is safe to run again: it only acts on records whose dates have passed.
        </p>
        <div className="row">
          {button("Run daily job", "runDailyJobs")}
          {button("Recalculate liquidity", "recalcLiquidity")}
          {button(`Send outbox (${props.pendingEmails})`, "processOutbox")}
          {button("Expire checkout holds", "expireCheckoutHolds")}
        </div>
      </div>
      {props.demo && (
        <div className="surface panel stack">
          <h2>Demo controls</h2>
          <div className="row">
            {button("Advance clock +1 day", "advanceDemoClock", { days: 1 })}
            {button(
              "Advance clock +7 days",
              "advanceDemoClock",
              { days: 7 },
              "Move the business clock forward 7 days and run the daily job?",
            )}
            {button(
              "Reset clock to today",
              "setDemoSettings",
              { resetClock: true },
              "Move the business clock back to the real date?",
            )}
            {button(
              props.simulatePayoutFailure ? "Turn payout failures off" : "Simulate payout failures",
              "setDemoSettings",
              { simulatePayoutFailure: !props.simulatePayoutFailure },
            )}
          </div>
          {props.simulatePayoutFailure && (
            <p className="form-error">Payout failures are being simulated.</p>
          )}
        </div>
      )}
      {result && (
        <p className="form-notice" role="status">
          {result}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

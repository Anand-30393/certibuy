"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { command } from "@/lib/api";

const PHRASE = "RESET DEMO DATA";

type Result = {
  removed: { deals: number; devices: number; orders: number; payouts: number; files: number };
  kept: { deals: number; orders: number };
};

/** O-11: typed confirmation, then the server removes demo/test accounts' data only. */
export default function DemoResetPanel() {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!window.confirm("Remove all demo and test data? Real customers' data is kept.")) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await command<Result>("resetDemoData", { confirm: typed });
      setDone(
        `Removed ${r.removed.deals} deals, ${r.removed.devices} devices, ${r.removed.orders} orders and ${r.removed.payouts} payouts. Kept ${r.kept.deals} deals and ${r.kept.orders} orders linked to real customers.`,
      );
      setTyped("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="surface panel stack" onSubmit={onSubmit}>
      <h2>Reset demo data</h2>
      <p className="meta">
        Removes deals, devices, orders, payouts, notifications and support requests that belong only
        to demo and test accounts (@certibuy.test), resets the demo clock and payout-failure switch.
        Anything a real customer took part in is kept. Settings, catalogue, hubs and accounts stay.
      </p>
      <label className="field">
        <span className="field-label">Type {PHRASE} to confirm</span>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </label>
      <div className="row">
        <button type="submit" className="button" disabled={busy || typed !== PHRASE}>
          {busy ? "Resetting…" : "Reset demo data"}
        </button>
        {error && (
          <span className="form-error" role="alert">
            {error}
          </span>
        )}
      </div>
      {done && (
        <p className="form-notice" role="status">
          {done}
        </p>
      )}
    </form>
  );
}

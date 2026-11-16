"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { command } from "@/lib/api";

export default function BookingActions(props: { submissionId: string; canSwitch: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "switch_to_guaranteed" | "cancel") {
    if (action === "cancel" && !window.confirm("Cancel this hub booking?")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await command<{ next: string }>("manageBooking", {
        submissionId: props.submissionId,
        action,
      });
      router.push(r.next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row">
      <Link href={`/seller/sell/${props.submissionId}/hub`}>Change booking</Link>
      {props.canSwitch && (
        <button
          type="button"
          className="link-button"
          disabled={busy}
          onClick={() => act("switch_to_guaranteed")}
        >
          Switch to Sell For More
        </button>
      )}
      <button type="button" className="link-button" disabled={busy} onClick={() => act("cancel")}>
        Cancel booking
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

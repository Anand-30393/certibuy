"use client";

// S-14: the seller's decision on a revised price at the counter.
import { formatInr } from "@certibuy/domain";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { command } from "@/lib/api";

export default function RevisedOfferDecision(props: {
  submissionId: string;
  quoted: number | null;
  revised: number | null;
  finalGrade: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(name: "acceptRevised" | "declineRevised") {
    if (name === "declineRevised" && !window.confirm("Decline and take your device back?")) return;
    setBusy(true);
    setError(null);
    try {
      await command(name, { submissionId: props.submissionId });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface panel stack">
      <p className="field-label">Revised price at the counter</p>
      <p>
        The technician graded your device {props.finalGrade}, one grade below the quoted range. The
        price changes from {props.quoted !== null ? formatInr(props.quoted) : "—"} to{" "}
        <strong>{props.revised !== null ? formatInr(props.revised) : "—"}</strong>.
      </p>
      <div className="row">
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={() => decide("acceptRevised")}
        >
          Accept the revised price
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => decide("declineRevised")}
        >
          Decline and take my device back
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

"use client";

import type { SubmissionViewT } from "@certibuy/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Money } from "@/components/common/ui";
import { command } from "@/lib/api";

export default function ConfirmStep(props: {
  sub: SubmissionViewT;
  option: "instant_cash" | "sell_for_more";
}) {
  const router = useRouter();
  const o = props.sub.offer;
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!o) return null;
  const amount = props.option === "instant_cash" ? (o.instantCashAmount ?? 0) : o.guaranteedPrice;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const r = await command<{ next: string }>("acceptOffer", {
        submissionId: props.sub.id,
        option: props.option,
        consent: true,
      });
      router.push(r.next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="surface panel stack">
        <p className="field-label">
          {props.option === "instant_cash" ? "Instant Cash" : "Sell For More"}
        </p>
        <Money amount={amount} large />
        <ul>
          <li>
            Bring the device to a CertiBuy hub. A technician checks its identity and condition.
          </li>
          <li>If the grade is inside your expected range, this price stands.</li>
          <li>
            One grade lower gives you a revised offer you can accept or decline at the counter.
          </li>
          <li>Two or more grades lower: we return the device and a small mismatch fee applies.</li>
          {props.option === "sell_for_more" && (
            <li>
              You get <Money amount={o.advance} /> at handover and <Money amount={o.balance} /> when
              it sells or on day {o.balanceDay}.
            </li>
          )}
        </ul>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>I agree to these terms and confirm the details I gave are true.</span>
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="sticky-footer row">
        <Link href={`/seller/sell/${props.sub.id}/offer`}>Back to offer</Link>
        <button
          type="button"
          className="button primary"
          disabled={!consent || busy}
          onClick={accept}
        >
          {busy ? "Accepting…" : "Accept and book a hub slot"}
        </button>
      </div>
    </div>
  );
}

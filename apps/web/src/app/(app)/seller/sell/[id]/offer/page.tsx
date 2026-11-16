// S-07 / S-08: the offer — Sell For More always, Instant Cash only when eligible.
import type { SubmissionViewT } from "@certibuy/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDate, Money } from "@/components/common/ui";
import StepRail from "@/components/seller/StepRail";
import { loadView } from "@/server/views";

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sub = await loadView<SubmissionViewT>("getSubmission", { submissionId: id });
  if (!sub.offer) redirect(`/seller/sell/${id}/result`);
  if (sub.status !== "graded") redirect(`/seller/deals/${id}`);
  const o = sub.offer;

  return (
    <section className="stack narrow">
      <StepRail current="offer" />
      <h1>Your offer</h1>
      <p className="meta">Valid until {formatDate(o.expiresAt)}.</p>

      <div className="tile-grid">
        <div className="surface panel stack">
          <p className="field-label">Sell For More · guaranteed</p>
          <Money amount={o.guaranteedPrice} large />
          <p>
            <Money amount={o.advance} /> at the counter, then <Money amount={o.balance} /> when it
            sells or on day {o.balanceDay}, whichever comes first.
          </p>
          <Link href={`/seller/sell/${id}/confirm?option=sell_for_more`} className="button primary">
            Choose Sell For More
          </Link>
        </div>

        <div className="surface panel stack">
          <p className="field-label">Instant Cash · paid in full at the counter</p>
          {o.icEligible && o.instantCashAmount !== null ? (
            <>
              <Money amount={o.instantCashAmount} large />
              <p>The whole amount is paid when you hand the device over.</p>
              <Link href={`/seller/sell/${id}/confirm?option=instant_cash`} className="button">
                Choose Instant Cash
              </Link>
            </>
          ) : (
            <p>{o.icReason ?? "Instant Cash isn't available for this device right now."}</p>
          )}
        </div>
      </div>

      <details className="surface panel">
        <summary>How we worked this out</summary>
        <table className="breakdown">
          <tbody>
            <tr>
              <td>Market price at grade {sub.assessment?.estimate}</td>
              <td>
                <Money amount={o.breakdown.market} />
              </td>
            </tr>
            <tr>
              <td>CertiBuy commission ({o.breakdown.commissionPct}%)</td>
              <td>
                − <Money amount={o.breakdown.commission} />
              </td>
            </tr>
            <tr>
              <td>Inspection fee</td>
              <td>
                − <Money amount={o.breakdown.inspectionFee} />
              </td>
            </tr>
            <tr>
              <th>Guaranteed price</th>
              <th>
                <Money amount={o.guaranteedPrice} />
              </th>
            </tr>
            {o.icEligible && (
              <tr>
                <td>Instant Cash adds a {o.riskPct}% resale risk deduction</td>
                <td>
                  − <Money amount={o.breakdown.risk} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </details>
    </section>
  );
}

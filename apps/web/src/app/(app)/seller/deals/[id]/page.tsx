// S-11 / S-10: deal tracker with the Sell For More money progress.
import type { DealTrackerView } from "@certibuy/contracts";
import { STEP_PATH, type WizardStep } from "@certibuy/application";
import Link from "next/link";
import type { z } from "zod";
import { EmptyPanel, formatDate, GradeChip, Money, StatusChip } from "@/components/common/ui";
import BookingActions from "@/components/seller/BookingActions";
import PaymentsTable from "@/components/seller/PaymentsTable";
import RevisedOfferDecision from "@/components/seller/RevisedOfferDecision";
import { loadView } from "@/server/views";

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const {
    submission: sub,
    payouts,
    timeline,
  } = await loadView<z.infer<typeof DealTrackerView>>("getDealTracker", { submissionId: id });
  const o = sub.offer;
  const step = sub.nextStep as WizardStep;
  const agreed =
    o && sub.chosenOption === "instant_cash"
      ? (o.instantCashAmount ?? 0)
      : (o?.guaranteedPrice ?? null);

  return (
    <section className="stack">
      <div className="row">
        <h1>
          {sub.model.brand} {sub.model.model} {sub.model.storage}
        </h1>
        <StatusChip group="submission" value={sub.status} />
      </div>

      {["details", "photos", "diagnostics", "offer", "hub"].includes(step) && (
        <Link href={STEP_PATH[step](sub.id)} className="button primary">
          Continue
        </Link>
      )}

      {sub.inspection?.verdict === "one_below" && sub.inspection.sellerDecision === "pending" && (
        <RevisedOfferDecision
          submissionId={sub.id}
          quoted={sub.inspection.quoted}
          revised={sub.inspection.revised}
          finalGrade={sub.inspection.finalGrade}
        />
      )}
      {sub.inspection?.finalGrade && sub.inspection.sellerDecision !== "pending" && (
        <p className="row">
          Counter grade <GradeChip grade={sub.inspection.finalGrade} />
          {sub.inspection.verdict && <StatusChip group="verdict" value={sub.inspection.verdict} />}
        </p>
      )}

      {o && agreed !== null && (
        <div className="surface panel stack">
          <p className="field-label">
            {sub.chosenOption ? (
              <StatusChip group="payout_option" value={sub.chosenOption} />
            ) : (
              "Offer"
            )}
          </p>
          <Money amount={agreed} large />
          {sub.assessment && (
            <p className="row">
              Expected grade{" "}
              {sub.assessment.band.map((g) => (
                <GradeChip key={g} grade={g} />
              ))}
            </p>
          )}
          {sub.chosenOption === "sell_for_more" && (
            <div className="split" aria-label="Sell For More payments">
              <div>
                <p className="meta">At handover (50%)</p>
                <Money amount={o.advance} />
              </div>
              <div>
                <p className="meta">When it sells or on day {o.balanceDay}</p>
                <Money amount={o.balance} />
              </div>
            </div>
          )}
        </div>
      )}

      {sub.booking && sub.booking.status === "booked" && (
        <div className="surface panel stack">
          <p className="field-label">Hub visit</p>
          <p>
            {sub.booking.hubName}, {formatDate(sub.booking.date)} at {sub.booking.slot}
            <br />
            <span className="meta">{sub.booking.hubAddress}</span>
          </p>
          <BookingActions submissionId={sub.id} canSwitch={sub.chosenOption === "instant_cash"} />
        </div>
      )}

      <h2>Payments</h2>
      {payouts.length === 0 ? (
        <EmptyPanel title="No payments yet">
          <p>Your first payment is made at the hub counter when you hand the device over.</p>
        </EmptyPanel>
      ) : (
        <PaymentsTable payouts={payouts} />
      )}

      <h2>Timeline</h2>
      <ol className="timeline">
        {timeline.map((t) => (
          <li key={t.at + t.text}>
            <span className="meta">{formatDate(t.at)}</span> {t.text}
          </li>
        ))}
      </ol>
      <p className="meta">
        Need help with this deal? <Link href="/help">Contact customer care</Link>.
      </p>
    </section>
  );
}

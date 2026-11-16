// S-06: automatic grade (or the reason we can't buy the device).
import type { SubmissionViewT } from "@certibuy/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GradeChip, Money, StatusChip } from "@/components/common/ui";
import StepRail from "@/components/seller/StepRail";
import { loadView } from "@/server/views";

export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sub = await loadView<SubmissionViewT>("getSubmission", { submissionId: id });

  if (sub.status === "rejected") {
    return (
      <section className="stack narrow">
        <StepRail current="result" />
        <h1>We can't buy this device</h1>
        <div className="surface empty-panel">
          <p>{sub.rejectReason}</p>
        </div>
        <Link href="/seller/sell" className="button">
          Value another device
        </Link>
      </section>
    );
  }
  if (!sub.assessment) redirect(`/seller/sell/${id}/diagnostics`);
  const a = sub.assessment;

  return (
    <section className="stack narrow">
      <StepRail current="result" />
      <h1>Your device is about grade {a.estimate}</h1>
      <div className="surface panel stack">
        <div className="row">
          <span className="field-label">Expected grade range</span>
          {a.band.map((g) => (
            <GradeChip key={g} grade={g} />
          ))}
          <StatusChip group="confidence" value={a.confidence} />
        </div>
        <p>
          If our technician confirms a grade inside this range, your price stands. Guaranteed price
          range: <Money amount={a.valueRange.low} /> – <Money amount={a.valueRange.high} />.
        </p>
        <ul>
          {a.factors.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className="meta">
          Automatic grading is a simulated estimate; the technician's grade is final.
        </p>
      </div>
      <Link href={`/seller/sell/${id}/offer`} className="button primary">
        See your offer
      </Link>
    </section>
  );
}

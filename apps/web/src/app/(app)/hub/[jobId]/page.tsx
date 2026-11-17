// T-02 … T-07: one counter visit.
import type { HubJobViewT } from "@certibuy/contracts";
import Link from "next/link";
import { GradeChip, Money, StatusChip } from "@/components/common/ui";
import HubJob from "@/components/hub/HubJob";
import { loadView } from "@/server/views";

export default async function HubJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = await loadView<HubJobViewT>("getHubJob", { submissionId: jobId });
  return (
    <section className="stack narrow">
      <Link href={`/hub?date=${job.booking.date}&hubId=${job.hub.id}`}>← Back to the queue</Link>
      <div className="surface panel stack">
        <div className="row">
          <h1>
            {job.device.brand} {job.device.model} {job.device.storage}
          </h1>
          <StatusChip group="submission" value={job.status} />
        </div>
        <p className="meta">
          {job.seller.name}
          {job.seller.phone ? ` · ${job.seller.phone}` : ""} · {job.booking.slot} at {job.hub.name}
          {job.device.colour ? ` · ${job.device.colour}` : ""}
          {job.device.declaredImeiLast4 ? ` · IMEI ends ${job.device.declaredImeiLast4}` : ""}
        </p>
        <div className="row">
          <span className="field-label">Quoted range</span>
          {job.ai.band.map((g) => (
            <GradeChip key={g} grade={g} />
          ))}
          {job.ai.confidence && <StatusChip group="confidence" value={job.ai.confidence} />}
          {job.option && <StatusChip group="payout_option" value={job.option} />}
          {job.agreedAmount !== null && <Money amount={job.agreedAmount} />}
        </div>
      </div>
      <HubJob job={job} />
    </section>
  );
}

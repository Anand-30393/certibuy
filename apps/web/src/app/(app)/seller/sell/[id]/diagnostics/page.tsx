// S-05: diagnostics, then automatic grading (S-06).
import type { SubmissionViewT } from "@certibuy/contracts";
import { redirect } from "next/navigation";
import DiagnosticsStep from "@/components/seller/DiagnosticsStep";
import StepRail from "@/components/seller/StepRail";
import { loadView } from "@/server/views";

export default async function DiagnosticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sub = await loadView<SubmissionViewT>("getSubmission", { submissionId: id });
  if (sub.status !== "draft") redirect(`/seller/sell/${id}/result`);
  if (sub.photos.some((p) => !p.uploaded)) redirect(`/seller/sell/${id}/photos`);
  return (
    <section className="stack narrow">
      <StepRail current="diagnostics" />
      <h1>Device checks</h1>
      <p>
        Run each check on the device and tell us the result. This is a self-check: our technician
        confirms everything at the hub.
      </p>
      <DiagnosticsStep sub={sub} />
    </section>
  );
}

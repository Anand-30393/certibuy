// S-04: guided photos.
import type { SubmissionViewT } from "@certibuy/contracts";
import { redirect } from "next/navigation";
import PhotosStep from "@/components/seller/PhotosStep";
import StepRail from "@/components/seller/StepRail";
import { loadView } from "@/server/views";

export default async function PhotosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sub = await loadView<SubmissionViewT>("getSubmission", { submissionId: id });
  if (sub.status !== "draft") redirect(`/seller/deals/${id}`);
  if (!sub.details.imei) redirect(`/seller/sell/${id}`);
  return (
    <section className="stack narrow">
      <StepRail current="photos" />
      <h1>Photos</h1>
      <p>
        {sub.photos.length} guided shots. Each one is checked on your phone for size and light
        before it uploads.
      </p>
      <PhotosStep sub={sub} />
    </section>
  );
}

// S-03: device details.
import type { SubmissionViewT } from "@certibuy/contracts";
import { redirect } from "next/navigation";
import DetailsForm from "@/components/seller/DetailsForm";
import StepRail from "@/components/seller/StepRail";
import { loadView } from "@/server/views";

export default async function DetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sub = await loadView<SubmissionViewT>("getSubmission", { submissionId: id });
  if (sub.status !== "draft") redirect(`/seller/deals/${id}`);
  return (
    <section className="stack narrow">
      <StepRail current="details" />
      <h1>
        {sub.model.brand} {sub.model.model} {sub.model.storage}
      </h1>
      <p>Tell us about its condition. Choose the option that fits best.</p>
      <DetailsForm sub={sub} />
    </section>
  );
}

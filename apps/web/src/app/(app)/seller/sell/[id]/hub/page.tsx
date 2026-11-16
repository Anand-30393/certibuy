// S-12: book a hub slot.
import type { SubmissionViewT } from "@certibuy/contracts";
import { redirect } from "next/navigation";
import HubBooking from "@/components/seller/HubBooking";
import StepRail from "@/components/seller/StepRail";
import { loadView } from "@/server/views";

export default async function HubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sub = await loadView<SubmissionViewT>("getSubmission", { submissionId: id });
  if (sub.status !== "offer_accepted" && sub.status !== "scheduled")
    redirect(`/seller/deals/${id}`);
  return (
    <section className="stack narrow">
      <StepRail current="hub" />
      <h1>Book a hub visit</h1>
      <p>Choose a hub, a day in the next five days and a time. The visit takes about 20 minutes.</p>
      <HubBooking sub={sub} />
    </section>
  );
}

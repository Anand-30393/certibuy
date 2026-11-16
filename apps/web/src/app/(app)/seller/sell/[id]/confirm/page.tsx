// S-09: accept with consent.
import type { SubmissionViewT } from "@certibuy/contracts";
import { redirect } from "next/navigation";
import ConfirmStep from "@/components/seller/ConfirmStep";
import StepRail from "@/components/seller/StepRail";
import { loadView } from "@/server/views";

export default async function ConfirmPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ option?: string }>;
}) {
  const { id } = await props.params;
  const { option } = await props.searchParams;
  const sub = await loadView<SubmissionViewT>("getSubmission", { submissionId: id });
  if (!sub.offer || sub.status !== "graded") redirect(`/seller/deals/${id}`);
  const chosen =
    option === "instant_cash" && sub.offer.icEligible ? "instant_cash" : "sell_for_more";
  return (
    <section className="stack narrow">
      <StepRail current="confirm" />
      <h1>Confirm your choice</h1>
      <ConfirmStep sub={sub} option={chosen} />
    </section>
  );
}

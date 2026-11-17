// O-07 exception queue: money cases link to their flows; others close with a resolution line.
import type { ExceptionQueueView } from "@certibuy/application";
import Link from "next/link";
import type { z } from "zod";
import { EmptyPanel, StatusChip } from "@/components/common/ui";
import CommandForm from "@/components/ops/CommandForm";
import OpsCommandButton from "@/components/ops/OpsCommandButton";
import { loadView } from "@/server/views";

export default async function ExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const resolved = status === "resolved";
  const { items } = await loadView<z.infer<typeof ExceptionQueueView>>("getExceptionQueue", {
    status: resolved ? "resolved" : "open",
  });
  return (
    <section className="stack">
      <h1>Exceptions</h1>
      <nav aria-label="Filter" className="filter-row">
        <Link href="/ops/exceptions" aria-current={resolved ? undefined : "page"}>
          Open
        </Link>
        <Link href="/ops/exceptions?status=resolved" aria-current={resolved ? "page" : undefined}>
          Resolved
        </Link>
      </nav>
      {items.length === 0 ? (
        <EmptyPanel title={resolved ? "No resolved cases" : "No open exceptions"} />
      ) : (
        items.map((c) => (
          <div key={c.id} className="surface panel stack">
            <div className="row">
              <span className="field-label">{c.title}</span>
              <StatusChip group="exception_type" value={c.type} />
              <StatusChip group="case_status" value={c.status} />
              <span className="meta">{c.ageDays} days old</span>
            </div>
            {c.detail && <p>{c.detail}</p>}
            {c.resolution && <p className="meta">Resolution: {c.resolution}</p>}
            {c.status === "open" && (
              <div className="stack">
                {c.action && <Link href={c.action.href}>{c.action.label}</Link>}
                {c.mismatchFeePending && c.relatedId && (
                  <OpsCommandButton
                    name="collectMismatchFee"
                    body={{ submissionId: c.relatedId }}
                    label="Record mismatch fee collected"
                  />
                )}
                {(c.type === "failed_inspection" || c.type === "grade_dispute") &&
                  c.relatedEntity === "submission" && (
                    <CommandForm
                      compact
                      name="upholdGrade"
                      fixed={{ caseId: c.id }}
                      fields={[
                        {
                          name: "note",
                          label: "Why the seller is right",
                          kind: "text",
                          required: true,
                        },
                      ]}
                      submitLabel="Resolve for the seller"
                      confirm="Waive any mismatch fee and resolve in the seller's favour?"
                    />
                  )}
                {c.type !== "return" && c.type !== "payment_hold" && (
                  <CommandForm
                    compact
                    name="resolveExceptionCase"
                    fixed={{ caseId: c.id }}
                    fields={[
                      { name: "resolution", label: "Resolution", kind: "text", required: true },
                    ]}
                    submitLabel="Close case"
                  />
                )}
              </div>
            )}
          </div>
        ))
      )}
    </section>
  );
}

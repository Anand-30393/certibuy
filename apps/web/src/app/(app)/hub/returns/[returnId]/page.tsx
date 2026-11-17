// T-08: return re-inspection.
import type { ReturnJobView } from "@certibuy/contracts";
import Link from "next/link";
import type { z } from "zod";
import { formatDate, GradeChip, StatusChip } from "@/components/common/ui";
import ReturnInspectionForm from "@/components/hub/ReturnInspectionForm";
import { loadView } from "@/server/views";

export default async function ReturnJobPage({ params }: { params: Promise<{ returnId: string }> }) {
  const { returnId } = await params;
  const r = await loadView<z.infer<typeof ReturnJobView>>("getReturnJob", { returnId });
  return (
    <section className="stack narrow">
      <Link href="/hub">← Back to the queue</Link>
      <div className="surface panel stack">
        <div className="row">
          <h1>{r.device}</h1>
          <GradeChip grade={r.grade} />
          <StatusChip group="return_status" value={r.status} />
        </div>
        <p className="meta">
          Tag <code>{r.tagId}</code> · raised {formatDate(r.raisedOn)} ·{" "}
          <StatusChip group="return_reason" value={r.reason} />
          {r.doaPreference ? ` · buyer prefers ${r.doaPreference}` : ""}
        </p>
        {r.note && <p>&ldquo;{r.note}&rdquo;</p>}
      </div>
      {r.status === "awaiting_reinspection" ? (
        <ReturnInspectionForm returnId={r.returnId} />
      ) : (
        <p>
          Re-inspected: recommendation {r.recommendation?.replace("_", " ")}. Operations will
          decide.
        </p>
      )}
    </section>
  );
}

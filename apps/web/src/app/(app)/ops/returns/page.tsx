// O-07 (returns part): resolve returns, including the approved DOA replacement.
import type { OpsReturnsView } from "@certibuy/contracts";
import { formatInr } from "@certibuy/domain";
import Link from "next/link";
import type { z } from "zod";
import { EmptyPanel, GradeChip, StatusChip } from "@/components/common/ui";
import OpsCommandButton from "@/components/ops/OpsCommandButton";
import { loadView } from "@/server/views";

export default async function OpsReturnsPage() {
  const { returns } = await loadView<z.infer<typeof OpsReturnsView>>("getOpsReturns");
  return (
    <section className="stack">
      <Link href="/ops">← Operations</Link>
      <h1>Returns to resolve</h1>
      {returns.length === 0 ? (
        <EmptyPanel title="No open returns" />
      ) : (
        returns.map((r) => (
          <div key={r.returnId} className="surface panel stack">
            <div className="row">
              <span className="field-label">
                {r.orderNo} · {r.device}
              </span>
              <GradeChip grade={r.grade} />
              <StatusChip group="return_reason" value={r.reason} />
              <StatusChip group="return_status" value={r.status} />
            </div>
            {r.note && <p>&ldquo;{r.note}&rdquo;</p>}
            <p className="meta">
              {r.recommendation
                ? `Technician recommends: ${r.recommendation.replace("_", " ")}.`
                : "Not re-inspected yet."}
              {r.doaPreference ? ` Buyer prefers ${r.doaPreference}.` : ""}
            </p>
            {r.replacement && (
              <p className="meta">
                Replacement unit: {r.replacement.device} grade {r.replacement.grade} (listed at{" "}
                {formatInr(r.replacement.price)}).
              </p>
            )}
            <div className="row">
              {r.outcomes.map((o) => (
                <OpsCommandButton
                  key={o.outcome}
                  name="resolveReturn"
                  body={{ returnId: r.returnId, outcome: o.outcome }}
                  label={
                    o.outcome === "doa_replacement"
                      ? "Send replacement"
                      : `${o.outcome.replace("_", " ")}: refund ${formatInr(o.refund)}`
                  }
                  disabled={!o.available}
                  confirm={`Resolve this return as "${o.outcome.replace("_", " ")}"?`}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}

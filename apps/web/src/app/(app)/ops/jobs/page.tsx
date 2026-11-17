// O-12 Jobs and O-11 demo controls.
import type { JobsBoardView } from "@certibuy/contracts";
import { formatInr } from "@certibuy/domain";
import Link from "next/link";
import type { z } from "zod";
import { formatDate, StatusChip } from "@/components/common/ui";
import JobsPanel from "@/components/ops/JobsPanel";
import OpsCommandButton from "@/components/ops/OpsCommandButton";
import { loadView } from "@/server/views";

export default async function JobsPage() {
  const b = await loadView<z.infer<typeof JobsBoardView>>("getJobsBoard");
  return (
    <section className="stack">
      <Link href="/ops">← Operations</Link>
      <h1>Jobs</h1>
      <p>
        Business date <strong>{formatDate(b.businessDate)}</strong>
        {b.simDayOffset
          ? ` (demo clock +${b.simDayOffset} days; real date ${formatDate(b.realDate)})`
          : ""}
        .
      </p>
      {!b.dailyRanToday && (
        <p className="notice" role="status">
          Today&apos;s daily job hasn&apos;t run yet. Prices and payouts reflect the last run.
        </p>
      )}
      <JobsPanel
        demo={b.demoMode && b.demoToolsEnabled}
        simulatePayoutFailure={b.simulatePayoutFailure}
        pendingEmails={b.pendingEmails}
      />

      {b.heldPayouts.length > 0 && (
        <div className="surface panel stack">
          <h2>Payouts on hold</h2>
          <ul className="list">
            {b.heldPayouts.map((p) => (
              <li key={p.payoutId} className="list-row">
                <span>
                  <StatusChip group="payout_type" value={p.type} /> {formatInr(p.amount)} ·{" "}
                  {p.attempts} attempts
                  {p.reason ? ` · ${p.reason}` : ""}
                </span>
                <OpsCommandButton
                  name="retryPayout"
                  body={{ payoutId: p.payoutId }}
                  label="Retry payout"
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="surface table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Job</th>
              <th scope="col">Business date</th>
              <th scope="col">Status</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {b.runs.map((r) => (
              <tr key={r.job + r.businessDate}>
                <td>{r.job}</td>
                <td>{formatDate(r.businessDate)}</td>
                <td>{r.status}</td>
                <td className="meta">
                  {Object.entries(r.counts)
                    .filter(([, v]) => v > 0)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(" · ") || "nothing to do"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

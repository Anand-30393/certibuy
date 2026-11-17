// Finance and escrow: read-only over the append-only ledgers, with reconciliation checks.
import type { FinanceView } from "@certibuy/application";
import { formatInr } from "@certibuy/domain";
import Link from "next/link";
import type { z } from "zod";
import { EmptyPanel } from "@/components/common/ui";
import { loadView } from "@/server/views";

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  const k = kind === "escrow" || kind === "payout" ? kind : undefined;
  const f = await loadView<z.infer<typeof FinanceView>>("getFinanceBoard", k ? { kind: k } : {});
  const tiles: [string, number][] = [
    [`Escrow held (${f.escrow.heldOrders} orders)`, f.escrow.held],
    ["Released to CertiBuy", f.escrow.released],
    ["Refunded to buyers", f.escrow.refunded],
    ["Seller payouts paid", f.payouts.paid],
    ["Payouts pending", f.payouts.pending],
    ["Balances due", f.payouts.due],
    ["Payouts on hold", f.payouts.onHold],
    ["Mismatch fees collected", f.payouts.mismatchFees],
    ["B2B liquidation proceeds", f.liquidationProceeds],
  ];
  return (
    <section className="stack">
      <h1>Finance and escrow</h1>
      <p className="meta">
        Ledgers are append-only. Corrections are new rows, never edits. Payments and payouts are
        simulated.
      </p>
      <div className="kpi-grid">
        {tiles.map(([label, v]) => (
          <div key={label} className="surface kpi">
            <span className="meta">{label}</span>
            <strong>{formatInr(v)}</strong>
          </div>
        ))}
      </div>
      <div className={`surface panel stack ${f.anomalies.length ? "ledger-anomaly" : ""}`}>
        <h2>Reconciliation</h2>
        {f.anomalies.length === 0 ? (
          <p role="status">All escrow ledgers reconcile with their orders.</p>
        ) : (
          <ul className="list" role="alert">
            {f.anomalies.map((a, n) => (
              <li key={n}>
                {a.orderNo}: {a.issue}
              </li>
            ))}
          </ul>
        )}
      </div>
      <nav aria-label="Ledger filter" className="filter-row">
        <Link href="/ops/finance" aria-current={!k ? "page" : undefined}>
          All movements
        </Link>
        <Link href="/ops/finance?kind=escrow" aria-current={k === "escrow" ? "page" : undefined}>
          Escrow and refunds
        </Link>
        <Link href="/ops/finance?kind=payout" aria-current={k === "payout" ? "page" : undefined}>
          Payouts
        </Link>
      </nav>
      {f.ledger.length === 0 ? (
        <EmptyPanel title="No money movements yet" />
      ) : (
        <div className="surface table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Ledger</th>
                <th scope="col">Type</th>
                <th scope="col">Reference</th>
                <th scope="col">Amount</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {f.ledger.map((r, n) => (
                <tr key={n}>
                  <td>{new Date(r.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                  <td>{r.kind}</td>
                  <td>{r.type.replaceAll("_", " ")}</td>
                  <td>{r.reference}</td>
                  <td>{formatInr(r.amount)}</td>
                  <td className="meta">{r.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

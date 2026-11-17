// O-01 overview and O-02 alerts.
import type { OpsAlertsView, OpsOverviewView } from "@certibuy/application";
import { formatInr } from "@certibuy/domain";
import Link from "next/link";
import type { z } from "zod";
import { EmptyPanel, formatDate } from "@/components/common/ui";
import { loadView } from "@/server/views";

export default async function OpsHome() {
  const [o, a] = await Promise.all([
    loadView<z.infer<typeof OpsOverviewView>>("getOpsOverview"),
    loadView<z.infer<typeof OpsAlertsView>>("getOpsAlerts"),
  ]);
  const k = o.kpis;
  const kpis: [string, string][] = [
    ["Listed now", String(k.listed)],
    ["In refurbishment", String(k.inRefurbishment)],
    ["Orders (7 days)", String(k.ordersLast7)],
    ["GMV (30 days)", formatInr(k.gmvLast30)],
    ["Escrow held", formatInr(k.escrowHeld)],
    ["Open returns", String(k.openReturns)],
    ["Open exceptions", String(k.openExceptions)],
    ["Payouts on hold", String(k.payoutsOnHold)],
  ];
  const alerts = a.groups.filter((g) => g.items.length > 0);
  return (
    <section className="stack">
      <h1>Operations overview</h1>
      <p className="meta">Business date {formatDate(o.businessDate)}</p>
      <div className="kpi-grid">
        {kpis.map(([label, value]) => (
          <div key={label} className="surface kpi">
            <span className="meta">{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <div className="surface panel stack">
        <h2>Needs attention</h2>
        {o.attention.length === 0 ? (
          <p className="meta">Nothing needs attention right now.</p>
        ) : (
          <ul className="list">
            {o.attention.map((x) => (
              <li key={x.label} className="list-row">
                <Link href={x.href}>{x.label}</Link>
                <strong>{x.count}</strong>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="surface panel stack">
        <h2>Alerts</h2>
        {alerts.length === 0 ? (
          <p className="meta">No alerts in the alert window.</p>
        ) : (
          alerts.map((g) => (
            <div key={g.key} className="stack">
              <h3>
                {g.title} ({g.items.length})
              </h3>
              <ul className="list">
                {g.items.slice(0, 8).map((i, n) => (
                  <li key={n}>
                    <Link href={i.href}>{i.text}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="surface table-wrap">
        <table className="table">
          <caption className="field-label">Listed stock by days on shelf</caption>
          <thead>
            <tr>
              {o.stockAge.map((b) => (
                <th key={b.bucket} scope="col">
                  {b.bucket} days
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {o.stockAge.map((b) => (
                <td key={b.bucket}>{b.count}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="surface table-wrap">
        <table className="table">
          <caption className="field-label">Hubs today</caption>
          <thead>
            <tr>
              <th scope="col">Hub</th>
              <th scope="col">Bookings</th>
              <th scope="col">Capacity</th>
            </tr>
          </thead>
          <tbody>
            {o.hubsToday.map((h) => (
              <tr key={h.hub}>
                <td>{h.hub}</td>
                <td>{h.bookings}</td>
                <td>{h.capacity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {o.activity.length === 0 ? (
        <EmptyPanel title="No activity yet" />
      ) : (
        <div className="surface panel stack">
          <h2>Recent activity</h2>
          <ul className="list">
            {o.activity.map((x, n) => (
              <li key={n} className="meta">
                {new Date(x.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · {x.actor}:{" "}
                {x.text}
              </li>
            ))}
          </ul>
          <Link href="/ops/audit">Open the audit log</Link>
        </div>
      )}
    </section>
  );
}

// O-14 audit log: every staff action with actor, business date and the record it touched.
import type { AuditView } from "@certibuy/application";
import Link from "next/link";
import type { z } from "zod";
import { EmptyPanel } from "@/components/common/ui";
import { loadView } from "@/server/views";

type Params = { q?: string; entity?: string; from?: string; to?: string; page?: string };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const date = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const input = {
    ...(p.q ? { q: p.q.slice(0, 80) } : {}),
    ...(p.entity ? { entity: p.entity.slice(0, 30) } : {}),
    ...(date(p.from) ? { from: date(p.from) } : {}),
    ...(date(p.to) ? { to: date(p.to) } : {}),
    page: Math.max(1, Math.min(500, Number(p.page) || 1)),
  };
  const a = await loadView<z.infer<typeof AuditView>>("getAuditLog", input);
  const qs = (page: number) =>
    new URLSearchParams({
      ...Object.fromEntries(Object.entries(input).map(([k, v]) => [k, String(v)])),
      page: String(page),
    }).toString();
  return (
    <section className="stack">
      <h1>Audit log</h1>
      <form className="row" role="search">
        <label className="field">
          <span className="field-label">Text or person</span>
          <input name="q" defaultValue={p.q ?? ""} />
        </label>
        <label className="field">
          <span className="field-label">Record type</span>
          <select name="entity" defaultValue={p.entity ?? ""}>
            <option value="">Any</option>
            {[
              "submission",
              "device",
              "listing",
              "order",
              "return_request",
              "payout",
              "settings",
              "device_model",
              "hub",
              "profile",
              "invitation",
              "support_request",
            ].map((e) => (
              <option key={e} value={e}>
                {e.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">From</span>
          <input type="date" name="from" defaultValue={p.from ?? ""} />
        </label>
        <label className="field">
          <span className="field-label">To</span>
          <input type="date" name="to" defaultValue={p.to ?? ""} />
        </label>
        <button className="button" type="submit">
          Filter
        </button>
      </form>
      {a.entries.length === 0 ? (
        <EmptyPanel title="No entries match" />
      ) : (
        <div className="surface table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Business date</th>
                <th scope="col">Who</th>
                <th scope="col">Record</th>
                <th scope="col">What happened</th>
              </tr>
            </thead>
            <tbody>
              {a.entries.map((e, n) => (
                <tr key={n}>
                  <td>{new Date(e.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                  <td>{e.businessDate}</td>
                  <td>{e.actor}</td>
                  <td className="meta">
                    {e.entity?.replaceAll("_", " ")} {e.entityId ? `· ${e.entityId.slice(-8)}` : ""}
                  </td>
                  <td>{e.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row">
        {a.page > 1 && <Link href={`/ops/audit?${qs(a.page - 1)}`}>← Newer</Link>}
        {a.hasMore && <Link href={`/ops/audit?${qs(a.page + 1)}`}>Older →</Link>}
      </div>
    </section>
  );
}

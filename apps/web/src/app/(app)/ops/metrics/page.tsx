// O-10 metrics: nine weekly measures against their targets (8 weeks).
import type { MetricsView } from "@certibuy/application";
import type { z } from "zod";
import { formatDate } from "@/components/common/ui";
import { loadView } from "@/server/views";

const fmt = (v: number | null, unit: string) =>
  v === null
    ? "—"
    : unit === "%"
      ? `${v}%`
      : unit === "₹"
        ? `₹${v.toLocaleString("en-IN")}`
        : String(v);

export default async function MetricsPage() {
  const m = await loadView<z.infer<typeof MetricsView>>("getMetrics");
  return (
    <section className="stack">
      <h1>Metrics</h1>
      <div className="surface table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">Target</th>
              <th scope="col">Current</th>
              {m.weeks.map((w) => (
                <th key={w} scope="col">
                  {formatDate(w)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.metrics.map((x) => {
              const met =
                x.current === null
                  ? null
                  : x.direction === "atMost"
                    ? x.current <= x.target
                    : x.current >= x.target;
              return (
                <tr key={x.key}>
                  <th scope="row">
                    {x.label}
                    <div className="meta">{x.purpose}</div>
                  </th>
                  <td>
                    {x.direction === "atMost" ? "≤ " : "≥ "}
                    {fmt(x.target, x.unit)}
                  </td>
                  <td>
                    {fmt(x.current, x.unit)}{" "}
                    {met === null ? "" : met ? "(on target)" : "(off target)"}
                  </td>
                  {x.periods.map((v, n) => (
                    <td key={n}>{fmt(v, x.unit)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

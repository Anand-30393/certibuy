// O-05 liquidity board: scores, exposure against caps and the Instant Cash pause switch.
import type { LiquidityBoardView } from "@certibuy/application";
import { formatInr } from "@certibuy/domain";
import type { z } from "zod";
import { EmptyPanel } from "@/components/common/ui";
import OpsCommandButton from "@/components/ops/OpsCommandButton";
import { loadView } from "@/server/views";

export default async function LiquidityPage() {
  const b = await loadView<z.infer<typeof LiquidityBoardView>>("getLiquidityBoard");
  return (
    <section className="stack">
      <h1>Liquidity</h1>
      <p className="meta">
        Instant Cash needs a score of at least {b.threshold}. Per-model exposure cap{" "}
        {formatInr(b.perModelCap)}. Recalculate scores from Jobs.
      </p>
      {b.models.length === 0 ? (
        <EmptyPanel title="No active models" />
      ) : (
        <div className="surface table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Score</th>
                <th scope="col">Trend</th>
                <th scope="col">Days to sell</th>
                <th scope="col">Stock · exposure</th>
                <th scope="col">Instant Cash</th>
              </tr>
            </thead>
            <tbody>
              {b.models.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.name}
                    <div className="meta">
                      {m.tier} tier{m.launchWindow ? " · successor launch window" : ""}
                    </div>
                  </td>
                  <td>
                    {m.score ?? "—"}{" "}
                    {m.score !== null && m.score < b.threshold ? "(below threshold)" : ""}
                    <div className="meta">
                      {m.source === "measured" ? "measured" : m.source ? "cold start" : ""}
                    </div>
                  </td>
                  <td className="meta">{m.trend.join(" → ") || "—"}</td>
                  <td>{m.daysToSell ?? "—"}</td>
                  <td>
                    {m.stock} · {formatInr(m.exposure)}
                    {m.exposure >= b.perModelCap ? <div className="meta">At cap</div> : null}
                  </td>
                  <td>
                    <OpsCommandButton
                      name="setIcPaused"
                      body={{ modelId: m.id, paused: !m.icPaused }}
                      label={m.icPaused ? "Paused — resume" : "Active — pause"}
                      confirm={
                        m.icPaused
                          ? undefined
                          : "Pause Instant Cash? Sellers with a live Instant Cash offer will be told."
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

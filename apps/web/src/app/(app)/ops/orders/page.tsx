// Ops: advance shipments (simulated courier).
import type { OpsOrdersView } from "@certibuy/contracts";
import Link from "next/link";
import type { z } from "zod";
import { EmptyPanel, StatusChip } from "@/components/common/ui";
import OpsCommandButton from "@/components/ops/OpsCommandButton";
import { loadView } from "@/server/views";

export default async function OpsOrdersPage() {
  const { orders } = await loadView<z.infer<typeof OpsOrdersView>>("getOpsOrders");
  return (
    <section className="stack">
      <Link href="/ops">← Operations</Link>
      <h1>Orders and shipments</h1>
      <p className="meta">The courier is simulated: each click moves a shipment one step.</p>
      {orders.length === 0 ? (
        <EmptyPanel title="No open orders" />
      ) : (
        <ul className="list">
          {orders.map((o) => (
            <li key={o.orderId} className="surface list-row">
              <div>
                <p className="field-label">
                  {o.orderNo} · {o.device}
                </p>
                <p className="meta">{o.buyer}</p>
              </div>
              <StatusChip group="order" value={o.status} />
              {o.next ? (
                <OpsCommandButton
                  name="advanceShipment"
                  body={{ orderId: o.orderId }}
                  label={o.next}
                />
              ) : (
                <span className="meta">Waiting for the return window</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

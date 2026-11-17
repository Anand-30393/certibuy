// B-08: my orders.
import type { MyOrdersView } from "@certibuy/contracts";
import Link from "next/link";
import type { z } from "zod";
import { EmptyPanel, formatDate, GradeChip, Money, StatusChip } from "@/components/common/ui";
import { loadView } from "@/server/views";

export default async function OrdersPage() {
  const { items } = await loadView<z.infer<typeof MyOrdersView>>("getMyOrders");
  return (
    <section className="stack">
      <h1>My orders</h1>
      {items.length === 0 ? (
        <EmptyPanel title="No orders yet">
          <p>
            <Link href="/shop/browse">Browse certified devices</Link>
          </p>
        </EmptyPanel>
      ) : (
        <ul className="list">
          {items.map((o) => (
            <li key={o.orderId} className="surface list-row">
              <div>
                <p className="row">
                  <GradeChip grade={o.grade} /> <span className="field-label">{o.device}</span>
                </p>
                <p className="meta">
                  {o.orderNo} · {formatDate(o.placedAt)}
                </p>
              </div>
              <StatusChip group="order" value={o.status} />
              <Money amount={o.total} />
              <Link href={`/shop/orders/${o.orderId}`}>{o.nextAction ?? "View order"}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

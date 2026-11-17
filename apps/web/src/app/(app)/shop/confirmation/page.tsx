// B-06: one confirmation for every order created by the checkout.
import type { ConfirmationView } from "@certibuy/contracts";
import Link from "next/link";
import type { z } from "zod";
import { Money, StatusChip } from "@/components/common/ui";
import { loadView } from "@/server/views";

export default async function ConfirmationPage(props: {
  searchParams: Promise<{ ids?: string; removed?: string }>;
}) {
  const sp = await props.searchParams;
  const c = await loadView<z.infer<typeof ConfirmationView>>("getConfirmation", {
    ids: sp.ids ?? "",
  });
  const total = c.orders.reduce((a, o) => a + o.total, 0);
  return (
    <section className="stack narrow">
      <h1>
        Thank you — {c.orders.length === 1 ? "your order is" : `${c.orders.length} orders are`}{" "}
        confirmed
      </h1>
      {sp.removed && (
        <p className="notice" role="status">
          {sp.removed} {sp.removed === "1" ? "device was" : "devices were"} no longer available and
          {sp.removed === "1" ? " was" : " were"} not charged.
        </p>
      )}
      {c.orders.map((o) => (
        <div key={o.orderId} className="surface panel stack">
          <div className="row">
            <span className="field-label">{o.orderNo}</span>
            <StatusChip group="escrow" value={o.escrowStatus ?? "hold"} />
          </div>
          <p>{o.device}</p>
          <p>
            <Money amount={o.devicePrice} />
            {o.warrantyAddonAmount > 0 && (
              <>
                {" "}
                + warranty <Money amount={o.warrantyAddonAmount} />
              </>
            )}{" "}
            ={" "}
            <strong>
              <Money amount={o.total} />
            </strong>
          </p>
          <p className="meta">
            Delivering to {o.deliveryName}, {o.deliveryAddress}
          </p>
          <Link href={`/shop/orders/${o.orderId}`}>Track this order</Link>
        </div>
      ))}
      <p>
        Total paid{" "}
        <strong>
          <Money amount={total} />
        </strong>{" "}
        (simulated). Each order has its own tracking and a {c.returnWindowDays}-day return window
        from delivery.
      </p>
      <Link href="/shop/orders" className="button">
        All my orders
      </Link>
    </section>
  );
}

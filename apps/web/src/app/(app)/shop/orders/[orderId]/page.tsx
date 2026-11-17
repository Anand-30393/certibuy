// B-07 / B-10 / B-12: order tracking, cancellation, return outcome, replacement.
import type { OrderTrackingView } from "@certibuy/contracts";
import Link from "next/link";
import type { z } from "zod";
import { formatDate, GradeChip, Money, StatusChip } from "@/components/common/ui";
import OrderActions from "@/components/shop/OrderActions";
import { loadView } from "@/server/views";

export default async function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const t = await loadView<z.infer<typeof OrderTrackingView>>("getOrderTracking", { orderId });
  const s = t.summary;
  return (
    <section className="stack narrow">
      <Link href="/shop/orders">← My orders</Link>
      <div className="surface panel stack">
        <div className="row">
          <h1>{s.device}</h1>
          <GradeChip grade={s.grade} />
        </div>
        <p className="row">
          <span className="meta">{s.orderNo}</span>
          <StatusChip group="order" value={s.status} />
          {s.escrowStatus && <StatusChip group="escrow" value={s.escrowStatus} />}
        </p>
        <p>
          <Money amount={t.amounts.devicePrice} />
          {t.amounts.warrantyAddonAmount > 0 && (
            <>
              {" "}
              + warranty <Money amount={t.amounts.warrantyAddonAmount} />
            </>
          )}{" "}
          ={" "}
          <strong>
            <Money amount={t.amounts.total} />
          </strong>{" "}
          · {t.paymentMethod} (simulated)
        </p>
        {t.returnWindowClosesAt && (
          <p className="meta">Return window closes on {formatDate(t.returnWindowClosesAt)}.</p>
        )}
      </div>

      {t.replacement && (
        <div className="surface panel">
          <p className="field-label">Replacement</p>
          <p className="row">
            {t.replacement.device} <GradeChip grade={t.replacement.grade} />
            <span className="meta">
              {t.replacement.stage === "none"
                ? "Preparing dispatch"
                : `Replacement ${t.replacement.stage.replace("_", " ")}`}
            </span>
          </p>
        </div>
      )}

      {t.openReturn && (
        <div className="surface panel stack">
          <p className="field-label">Return</p>
          <p className="row">
            <StatusChip group="return_reason" value={t.openReturn.reason} />
            <StatusChip group="return_status" value={t.openReturn.status} />
            {t.openReturn.outcome && (
              <StatusChip group="return_outcome" value={t.openReturn.outcome} />
            )}
          </p>
          {t.openReturn.refund !== null && t.openReturn.outcome !== "doa_replacement" && (
            <p>
              Refund <Money amount={t.openReturn.refund} />
              {t.openReturn.deduction ? (
                <>
                  {" "}
                  (<Money amount={t.openReturn.deduction} /> deducted)
                </>
              ) : null}
            </p>
          )}
        </div>
      )}

      {t.refund && !t.openReturn && (
        <div className="surface panel">
          <p className="field-label">Refund</p>
          <p>
            <Money amount={t.refund.amount} /> refunded (simulated).
          </p>
        </div>
      )}

      <OrderActions
        orderId={orderId}
        canCancel={t.canCancel}
        cancelRefund={t.cancelRefund}
        canReturn={t.canReturn}
        canAdvanceShipment={t.canAdvanceShipment}
      />

      <div className="surface panel stack">
        <h2>Timeline</h2>
        <ol className="timeline">
          {t.timeline.map((e) => (
            <li key={e.label + e.at}>
              <span className="meta">{formatDate(e.at)}</span> {e.label}
            </li>
          ))}
        </ol>
        <p className="meta">
          Delivering to {t.delivery.name}, {t.delivery.phone}, {t.delivery.address}
        </p>
      </div>
    </section>
  );
}

// B-09: raise a return (estimated refund shown before submitting).
import type { ReturnOptionsView } from "@certibuy/contracts";
import Link from "next/link";
import type { z } from "zod";
import { formatDate } from "@/components/common/ui";
import ReturnForm from "@/components/shop/ReturnForm";
import { loadView } from "@/server/views";

export default async function ReturnPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const o = await loadView<z.infer<typeof ReturnOptionsView>>("getReturnOptions", { orderId });
  return (
    <section className="stack narrow">
      <Link href={`/shop/orders/${orderId}`}>← Back to the order</Link>
      <h1>Return {o.device}</h1>
      {o.eligible ? (
        <>
          {o.closesAt && <p className="meta">Return window closes on {formatDate(o.closesAt)}.</p>}
          <ReturnForm
            orderId={orderId}
            options={o.options}
            replacementAllowed={o.replacementAllowed}
          />
        </>
      ) : (
        <div className="surface empty-panel">
          <p>{o.reason}</p>
        </div>
      )}
    </section>
  );
}

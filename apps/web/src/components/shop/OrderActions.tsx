"use client";

import { formatInr } from "@certibuy/domain";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { command } from "@/lib/api";

export default function OrderActions(props: {
  orderId: string;
  canCancel: boolean;
  cancelRefund: number;
  canReturn: boolean;
  canAdvanceShipment: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(name: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      await command(name, { orderId: props.orderId });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!props.canCancel && !props.canReturn && !props.canAdvanceShipment) return null;
  return (
    <div className="surface panel stack">
      {props.canCancel && (
        <div className="stack">
          <p>
            Not dispatched yet. Cancel now for a full refund of {formatInr(props.cancelRefund)}.
          </p>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() =>
              run(
                "cancelOrder",
                `Cancel this order? ${formatInr(props.cancelRefund)} will be refunded.`,
              )
            }
          >
            Cancel order
          </button>
        </div>
      )}
      {props.canReturn && (
        <Link href={`/shop/orders/${props.orderId}/return`} className="button">
          Raise a return
        </Link>
      )}
      {props.canAdvanceShipment && (
        <div className="stack">
          <p className="meta">
            Demo: the courier is simulated. Move this shipment to its next step.
          </p>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => run("advanceShipment")}
          >
            Advance shipment (simulated courier)
          </button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

import type { PayoutRowView } from "@certibuy/contracts";
import type { z } from "zod";
import { formatDate, Money, StatusChip } from "@/components/common/ui";

type Row = z.infer<typeof PayoutRowView>;

export default function PaymentsTable({
  payouts,
  showDevice,
}: {
  payouts: Row[];
  showDevice?: boolean;
}) {
  return (
    <div className="surface table-wrap">
      <table className="table">
        <thead>
          <tr>
            {showDevice && <th scope="col">Device</th>}
            <th scope="col">Payment</th>
            <th scope="col">Amount</th>
            <th scope="col">Status</th>
            <th scope="col">Date</th>
          </tr>
        </thead>
        <tbody>
          {payouts.map((p) => (
            <tr key={p.id}>
              {showDevice && <td>{p.device}</td>}
              <td>
                <StatusChip group="payout_type" value={p.type} />
              </td>
              <td>
                <Money amount={p.amount} />
              </td>
              <td>
                <StatusChip group="payout_status" value={p.status} />
                {p.failureReason && <p className="meta">{p.failureReason}. We'll contact you.</p>}
              </td>
              <td>
                {p.paidAt ? formatDate(p.paidAt) : p.dueOn ? `Due ${formatDate(p.dueOn)}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

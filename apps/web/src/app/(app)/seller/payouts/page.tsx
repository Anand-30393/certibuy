// S-13: payout history across all deals.
import type { SellerPayoutsView } from "@certibuy/contracts";
import type { z } from "zod";
import { EmptyPanel, Money } from "@/components/common/ui";
import PaymentsTable from "@/components/seller/PaymentsTable";
import { loadView } from "@/server/views";

export default async function PayoutsPage() {
  const { payouts, totals } = await loadView<z.infer<typeof SellerPayoutsView>>("getSellerPayouts");
  return (
    <section className="stack">
      <h1>Payouts</h1>
      <div className="tile-grid">
        <div className="surface panel">
          <p className="meta">Paid</p>
          <Money amount={totals.paid} large />
        </div>
        <div className="surface panel">
          <p className="meta">Processing</p>
          <Money amount={totals.pending} large />
        </div>
        <div className="surface panel">
          <p className="meta">Scheduled</p>
          <Money amount={totals.due} large />
        </div>
      </div>
      {payouts.length === 0 ? (
        <EmptyPanel title="No payouts yet">
          <p>Payouts appear here once you hand a device over at a hub.</p>
        </EmptyPanel>
      ) : (
        <PaymentsTable payouts={payouts} showDevice />
      )}
      <p className="meta">Payouts are simulated in this demo — no real money moves.</p>
    </section>
  );
}

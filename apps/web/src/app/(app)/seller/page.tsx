// S-01: sell landing and the seller's deals.
import type { z } from "zod";
import type { SellerHomeView } from "@certibuy/contracts";
import Link from "next/link";
import { EmptyPanel, Money, StatusChip } from "@/components/common/ui";
import { loadView } from "@/server/views";

export default async function SellerHome() {
  const { deals } = await loadView<z.infer<typeof SellerHomeView>>("getSellerHome");
  return (
    <section className="stack">
      <div className="hero surface">
        <h1>Sell your device to CertiBuy</h1>
        <p>
          Two ways to get paid: <strong>Instant Cash</strong>, paid in full at the hub counter, or{" "}
          <strong>Sell For More</strong>, a guaranteed price with 50% at the counter and the rest
          when it sells or on day 21.
        </p>
        <div className="row">
          <Link href="/seller/sell" className="button primary">
            Sell a device
          </Link>
          <Link href="/seller/payouts">Payout history</Link>
        </div>
      </div>

      <h2>Your deals</h2>
      {deals.length === 0 ? (
        <EmptyPanel title="No deals yet">
          <p>Start a valuation — it takes a few minutes and you'll see your offer straight away.</p>
        </EmptyPanel>
      ) : (
        <ul className="list">
          {deals.map((d) => (
            <li key={d.id} className="surface list-row">
              <div>
                <p className="field-label">{d.device}</p>
                <StatusChip group="submission" value={d.status} />
              </div>
              {d.amount !== null && <Money amount={d.amount} />}
              <Link href={d.nextAction?.href ?? `/seller/deals/${d.id}`}>
                {d.nextAction?.label ?? "View deal"}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

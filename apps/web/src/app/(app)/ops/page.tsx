// O-01 (placeholder until Phase 7) with links to the order and return queues built in Phase 5.
import Link from "next/link";
import AreaPlaceholder from "@/components/common/AreaPlaceholder";

export default function OpsHome() {
  return (
    <section className="stack">
      <div className="surface panel stack">
        <h1>Operations</h1>
        <div className="row">
          <Link href="/ops/orders" className="button">
            Orders and shipments
          </Link>
          <Link href="/ops/returns" className="button">
            Returns to resolve
          </Link>
          <Link href="/hub" className="button">
            Hub queue
          </Link>
        </div>
      </div>
      <AreaPlaceholder
        title="Console"
        intro="The full console arrives in later phases."
        phase="Phases 6 and 7"
        coming={[
          "Overview, alerts and jobs (O-01, O-02, O-12)",
          "Catalogue, pricing, liquidity and inventory (O-03 to O-06)",
          "Exceptions, hubs, users, support, audit and metrics (O-07 to O-15)",
        ]}
      />
    </section>
  );
}

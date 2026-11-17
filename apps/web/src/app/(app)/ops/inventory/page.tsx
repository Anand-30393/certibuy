// O-06 inventory: price override, list after refurbishment (grade D → no warranty), B2B liquidation.
import type { InventoryView } from "@certibuy/application";
import { formatInr } from "@certibuy/domain";
import Link from "next/link";
import type { z } from "zod";
import { EmptyPanel, GradeChip, StatusChip } from "@/components/common/ui";
import CommandForm from "@/components/ops/CommandForm";
import OpsCommandButton from "@/components/ops/OpsCommandButton";
import { loadView } from "@/server/views";

const FILTERS: [string, string][] = [
  ["", "All owned"],
  ["in_refurbishment", "In refurbishment"],
  ["listed", "Listed"],
  ["day45_review", "Day-45 review"],
  ["reserved", "Reserved"],
  ["liquidated", "Liquidated"],
];

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const filter = FILTERS.some(([v]) => v === status) ? status : undefined;
  const { items } = await loadView<z.infer<typeof InventoryView>>(
    "getOpsInventory",
    filter ? { status: filter } : {},
  );
  return (
    <section className="stack">
      <h1>Inventory</h1>
      <nav aria-label="Filter by status" className="filter-row">
        {FILTERS.map(([v, label]) => (
          <Link
            key={v}
            href={v ? `/ops/inventory?status=${v}` : "/ops/inventory"}
            aria-current={(filter ?? "") === v ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <EmptyPanel title="No devices here" />
      ) : (
        items.map((d) => (
          <div key={d.deviceId} className="surface panel stack">
            <div className="row">
              <span className="field-label">
                {d.device} · {d.tag}
              </span>
              <GradeChip grade={d.grade} />
              <StatusChip group="device" value={d.status} />
            </div>
            <p className="meta">
              {d.hub} · acquired {formatInr(d.cost)} · held {d.daysHeld} days
              {d.listing &&
                ` · listed ${d.listing.daysListed} days at ${formatInr(d.listing.overridePrice ?? d.listing.currentPrice)} (base ${formatInr(d.listing.basePrice)}, floor ${formatInr(d.listing.floorPrice)}, step ${d.listing.ladderStep}${d.listing.overridePrice ? ", override" : ""}) · ${d.listing.warrantyMonths ? `${d.listing.warrantyMonths}-month warranty` : "no warranty"}`}
            </p>
            {d.listing && ["active", "review"].includes(d.listing.status) && (
              <CommandForm
                compact
                name="setListingOverride"
                fixed={{ listingId: d.listing.id }}
                fields={[
                  {
                    name: "price",
                    label: "Override price (₹, blank clears)",
                    kind: "optionalNumber",
                    defaultValue: d.listing.overridePrice,
                    step: "1",
                  },
                  { name: "reason", label: "Reason", kind: "text", required: true },
                ]}
                submitLabel="Set price"
              />
            )}
            <div className="row">
              {(d.status === "in_refurbishment" || d.status === "day45_review") && (
                <CommandForm
                  compact
                  name="markRefurbishedAndList"
                  fixed={{ deviceId: d.deviceId, resetLadder: d.status === "in_refurbishment" }}
                  fields={[
                    {
                      name: "partsReplaced",
                      label: "Parts replaced (comma separated)",
                      kind: "list",
                    },
                  ]}
                  submitLabel={
                    d.status === "in_refurbishment" ? "Refurbished — list it" : "Keep listed"
                  }
                />
              )}
              {["listed", "day45_review", "in_refurbishment"].includes(d.status) && (
                <OpsCommandButton
                  name="liquidateDevice"
                  body={{ deviceId: d.deviceId }}
                  label={`Liquidate to B2B at ${formatInr(d.listing?.floorPrice ?? 0)}`}
                  confirm="Sell this device to the B2B partner at the floor price? This can't be undone."
                />
              )}
            </div>
          </div>
        ))
      )}
    </section>
  );
}

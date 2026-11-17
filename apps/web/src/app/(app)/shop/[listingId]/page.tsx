// B-03: listing detail with photos, grade, the sealed inspection report and price history.
import type { ListingDetailView } from "@certibuy/contracts";
import type { z } from "zod";
import { formatDate, GradeChip, Money, StatusChip } from "@/components/common/ui";
import BuyCard from "@/components/shop/BuyCard";
import { loadView } from "@/server/views";

export default async function ListingPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  const d = await loadView<z.infer<typeof ListingDetailView>>("getListingDetail", { listingId });
  const c = d.card;
  return (
    <section className="stack">
      <div className="detail-grid">
        <div className="stack">
          <h1>
            {c.brand} {c.model} {c.storage}
          </h1>
          <div className="row">
            <GradeChip grade={c.grade} />
            {c.colour && <span className="meta">{c.colour}</span>}
            {c.batteryHealth !== null && <span className="meta">Battery {c.batteryHealth}%</span>}
            <span className="meta">
              {c.warrantyMonths > 0 ? `${c.warrantyMonths}-month warranty` : "No warranty"}
            </span>
          </div>
          {d.photos.length > 0 ? (
            <div className="gallery">
              {d.photos.map((p) => (
                <figure key={p.label}>
                  <img src={p.url} alt={`${c.model}: ${p.label}`} />
                  <figcaption className="meta">{p.label}</figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <p className="meta">Photos are being prepared for this device.</p>
          )}
        </div>
        <BuyCard
          listingId={c.listingId}
          price={c.price}
          available={d.available}
          addonPrice={d.addonPrice}
          addonAvailable={d.addonAvailable}
          returnWindowDays={d.returnWindowDays}
        />
      </div>

      {d.inspection && (
        <div className="surface panel stack">
          <h2>Inspection report</h2>
          <p className="meta">
            Inspected and sealed at {d.inspection.hubName}
            {d.inspection.inspectedOn ? ` on ${formatDate(d.inspection.inspectedOn)}` : ""}.
          </p>
          <div className="row">
            {d.inspection.componentGrades &&
              Object.entries(d.inspection.componentGrades).map(([k, g]) => (
                <span key={k} className="row">
                  <span className="meta">{k}</span> <GradeChip grade={g} />
                </span>
              ))}
          </div>
          <ul className="list">
            {d.inspection.checklist.map((item) => (
              <li key={item.label} className="list-row">
                <span>{item.label}</span>
                <span className={`chip ${item.result === "pass" ? "tone-success" : "tone-danger"}`}>
                  {item.result === "pass" ? "Pass" : item.result === "fail" ? "Fail" : "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="surface panel stack">
        <h2>Price history</h2>
        <p>
          Listed on {formatDate(d.priceHistory.listedAt)} at{" "}
          <Money amount={d.priceHistory.basePrice} />.
          {d.priceHistory.currentPrice < d.priceHistory.basePrice ? (
            <>
              {" "}
              Now <Money amount={d.priceHistory.currentPrice} /> — you save{" "}
              <Money amount={d.priceHistory.basePrice - d.priceHistory.currentPrice} />.
            </>
          ) : null}
        </p>
        {!d.available && <StatusChip group="device" value="reserved" />}
      </div>
    </section>
  );
}

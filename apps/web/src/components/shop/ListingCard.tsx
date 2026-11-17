import type { ListingCardT } from "@certibuy/contracts";
import Link from "next/link";
import { GradeChip, Money } from "@/components/common/ui";

export default function ListingCard({ card }: { card: ListingCardT }) {
  return (
    <Link href={`/shop/${card.listingId}`} className="surface listing-card">
      <div className="row">
        <GradeChip grade={card.grade} />
        <span className="field-label">
          {card.brand} {card.model}
        </span>
      </div>
      <span className="meta">
        {card.storage}
        {card.colour ? ` · ${card.colour}` : ""}
        {card.batteryHealth !== null ? ` · battery ${card.batteryHealth}%` : ""}
      </span>
      <span className="row">
        <Money amount={card.price} />
        {card.stepped && (
          <span className="meta strike">
            <Money amount={card.basePrice} />
          </span>
        )}
      </span>
      <span className="meta">
        {card.warrantyMonths > 0 ? `${card.warrantyMonths}-month warranty` : "No warranty"} · ships
        from {card.hubCity}
      </span>
    </Link>
  );
}

export function ListingGrid({ cards }: { cards: ListingCardT[] }) {
  return (
    <div className="listing-grid">
      {cards.map((c) => (
        <ListingCard key={c.listingId} card={c} />
      ))}
    </div>
  );
}

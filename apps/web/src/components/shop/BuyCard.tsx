"use client";

import { formatInr } from "@certibuy/domain";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Money } from "@/components/common/ui";
import { addToCart, onCartChange, readCart } from "@/lib/cart";

export default function BuyCard(props: {
  listingId: string;
  price: number;
  available: boolean;
  addonPrice: number;
  addonAvailable: boolean;
  returnWindowDays: number;
}) {
  const router = useRouter();
  const [addon, setAddon] = useState(false);
  const [inCart, setInCart] = useState(false);

  useEffect(() => {
    const sync = () => setInCart(readCart().some((l) => l.listingId === props.listingId));
    sync();
    return onCartChange(sync);
  }, [props.listingId]);

  return (
    <aside className="surface panel stack buy-card">
      <Money amount={props.price + (addon ? props.addonPrice : 0)} large />
      {props.addonAvailable && (
        <label className="check-row">
          <input type="checkbox" checked={addon} onChange={(e) => setAddon(e.target.checked)} />
          <span>Add a second-year warranty for {formatInr(props.addonPrice)}</span>
        </label>
      )}
      {props.available ? (
        <div className="stack">
          <button
            type="button"
            className="button primary"
            onClick={() => {
              addToCart(props.listingId, addon);
              router.push("/shop/cart");
            }}
          >
            Buy now
          </button>
          <button
            type="button"
            className="button"
            disabled={inCart}
            onClick={() => addToCart(props.listingId, addon)}
          >
            {inCart ? "In your cart" : "Add to cart"}
          </button>
          {inCart && <Link href="/shop/cart">Go to cart</Link>}
        </div>
      ) : (
        <p className="form-error">This device has just been bought.</p>
      )}
      <p className="meta">
        Your payment is held in escrow. You have {props.returnWindowDays} days from delivery to
        raise a return.
      </p>
    </aside>
  );
}

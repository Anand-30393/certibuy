"use client";

// Cart and checkout in one screen: lines are re-validated by the server, delivery details are
// entered once, one simulated payment creates one order per device (Option A).
import type { CartView, PlaceOrdersOutput } from "@certibuy/contracts";
import { formatInr } from "@certibuy/domain";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { z } from "zod";
import { GradeChip, Money } from "@/components/common/ui";
import { command } from "@/lib/api";
import { readCart, removeFromCart, writeCart, type CartLine } from "@/lib/cart";

type Cart = z.infer<typeof CartView>;

export default function CartCheckout() {
  const router = useRouter();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const current = readCart();
    setLines(current);
    if (current.length === 0) return setCart(null);
    const res = await fetch(
      `/api/v1/views/getCart?ids=${encodeURIComponent(current.map((l) => l.listingId).join(","))}`,
    );
    if (res.ok) setCart((await res.json()) as Cart);
    else setError("We couldn't load your cart. Refresh to try again.");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const available = cart?.items.filter((i) => i.available && i.card) ?? [];
  const unavailable = cart?.items.filter((i) => !i.available) ?? [];
  const addonFor = (id: string) => lines.find((l) => l.listingId === id)?.warrantyAddon ?? false;
  const total = available.reduce(
    (a, i) =>
      a + (i.card?.price ?? 0) + (addonFor(i.listingId) && i.addonAvailable ? i.addonPrice : 0),
    0,
  );

  function toggleAddon(id: string) {
    writeCart(
      lines.map((l) => (l.listingId === id ? { ...l, warrantyAddon: !l.warrantyAddon } : l)),
    );
    setLines(readCart());
  }

  async function checkout(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await command<z.infer<typeof PlaceOrdersOutput>>("placeOrders", {
        items: available.map((i) => ({
          listingId: i.listingId,
          warrantyAddon: addonFor(i.listingId) && i.addonAvailable,
        })),
        deliveryName: String(f.get("name") ?? ""),
        deliveryPhone: String(f.get("phone") ?? ""),
        deliveryAddress: String(f.get("address") ?? ""),
        paymentMethod: String(f.get("method") ?? "upi"),
        declined: f.get("declined") === "on",
      });
      if (r.declined) {
        setError(
          "The payment was declined (simulated). Nothing was charged and no order was placed.",
        );
        return;
      }
      removeFromCart([...r.orders.map((o) => o.listingId), ...r.removed.map((x) => x.listingId)]);
      if (r.orders.length === 0) {
        setNotice("Those devices were bought by someone else moments ago. You were not charged.");
        await load();
        return;
      }
      router.push(
        `/shop/confirmation?ids=${r.orders.map((o) => o.orderId).join(",")}${r.removed.length ? `&removed=${r.removed.length}` : ""}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (lines.length === 0) {
    return (
      <div className="surface empty-panel">
        <p className="field-label">Your cart is empty</p>
        <p>
          <Link href="/shop/browse">Browse certified devices</Link>
        </p>
      </div>
    );
  }
  if (!cart) return <p role="status">Loading your cart…</p>;

  return (
    <div className="stack">
      {unavailable.length > 0 && (
        <div className="notice" role="status">
          {unavailable.length} {unavailable.length === 1 ? "device is" : "devices are"} no longer
          available and won&apos;t be charged.{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              removeFromCart(unavailable.map((u) => u.listingId));
              void load();
            }}
          >
            Remove
          </button>
        </div>
      )}
      <ul className="list">
        {available.map((i) => (
          <li key={i.listingId} className="surface list-row">
            <div>
              <p className="row">
                {i.card && <GradeChip grade={i.card.grade} />}
                <Link href={`/shop/${i.listingId}`}>
                  {i.card?.brand} {i.card?.model} {i.card?.storage}
                </Link>
              </p>
              {i.addonAvailable && (
                <label className="check-row meta">
                  <input
                    type="checkbox"
                    checked={addonFor(i.listingId)}
                    onChange={() => toggleAddon(i.listingId)}
                  />
                  <span>Second-year warranty +{formatInr(i.addonPrice)}</span>
                </label>
              )}
            </div>
            <Money
              amount={
                (i.card?.price ?? 0) +
                (addonFor(i.listingId) && i.addonAvailable ? i.addonPrice : 0)
              }
            />
            <button
              type="button"
              className="link-button"
              onClick={() => {
                removeFromCart([i.listingId]);
                void load();
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      {available.length > 0 && (
        <form className="surface panel stack" onSubmit={checkout}>
          <h2>Delivery</h2>
          <label className="field">
            <span className="field-label">Recipient name</span>
            <input
              name="name"
              defaultValue={cart.delivery.name}
              autoComplete="name"
              required
              minLength={2}
            />
          </label>
          <label className="field">
            <span className="field-label">Mobile number</span>
            <input
              name="phone"
              defaultValue={cart.delivery.phone}
              inputMode="tel"
              autoComplete="tel"
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Delivery address</span>
            <textarea
              name="address"
              defaultValue={cart.delivery.address}
              rows={3}
              autoComplete="street-address"
              required
              minLength={10}
            />
          </label>
          <fieldset className="field">
            <legend className="field-label">Payment method (simulated)</legend>
            <div className="chip-row">
              {[
                ["upi", "UPI"],
                ["card", "Card"],
                ["netbanking", "Net banking"],
              ].map(([v, label]) => (
                <label key={v} className="pill">
                  <input type="radio" name="method" value={v} defaultChecked={v === "upi"} />{" "}
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="check-row meta">
            <input type="checkbox" name="declined" />
            <span>Demo: simulate a declined payment</span>
          </label>
          <p>
            {available.length} {available.length === 1 ? "order" : "separate orders"} · total{" "}
            <strong>{formatInr(total)}</strong>, held in escrow until each return window closes (
            {cart.returnWindowDays} days from delivery).
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="form-notice" role="status">
              {notice}
            </p>
          )}
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? "Paying…" : `Pay ${formatInr(total)}`}
          </button>
          <p className="meta">Payment is simulated — no real money moves.</p>
        </form>
      )}
    </div>
  );
}

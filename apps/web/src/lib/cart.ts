// The cart lives in this browser only (a per-viewer convenience). The server re-validates every
// line at checkout; each device is unique, so a listing appears at most once (quantity 1).
export interface CartLine {
  listingId: string;
  warrantyAddon: boolean;
}

const KEY = "certibuy.cart.v1";
const EVENT = "certibuy:cart";

export function readCart(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (l): l is CartLine =>
            typeof l === "object" && l !== null && typeof (l as CartLine).listingId === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export function writeCart(lines: CartLine[]): void {
  const unique = lines.filter((l, i) => lines.findIndex((x) => x.listingId === l.listingId) === i);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(unique.slice(0, 10)));
  } catch {
    // Storage unavailable (private mode): the cart simply won't persist.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function addToCart(listingId: string, warrantyAddon = false): void {
  writeCart([...readCart().filter((l) => l.listingId !== listingId), { listingId, warrantyAddon }]);
}

export function removeFromCart(listingIds: string[]): void {
  writeCart(readCart().filter((l) => !listingIds.includes(l.listingId)));
}

export function onCartChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}

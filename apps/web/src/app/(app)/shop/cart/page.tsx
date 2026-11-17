import CartCheckout from "@/components/shop/CartCheckout";

// B-05: cart + checkout (Option A: each device becomes its own order).
export default function CartPage() {
  return (
    <section className="stack narrow">
      <h1>Your cart</h1>
      <CartCheckout />
    </section>
  );
}

// B-01: shop home.
import type { ShopHomeView } from "@certibuy/contracts";
import Link from "next/link";
import type { z } from "zod";
import { EmptyPanel } from "@/components/common/ui";
import { ListingGrid } from "@/components/shop/ListingCard";
import { loadView } from "@/server/views";

export default async function ShopHome() {
  const home = await loadView<z.infer<typeof ShopHomeView>>("getShopHome");
  return (
    <section className="stack">
      <div className="hero surface">
        <h1>Certified devices, held by CertiBuy</h1>
        <p>
          Every device was inspected and graded by our technicians, sealed and tagged, and is in our
          custody. Your payment stays in escrow until your 7-day return window closes.
        </p>
        <div className="row">
          <Link href="/shop/browse" className="button primary">
            Browse {home.listedCount} devices
          </Link>
          <Link href="/shop/grades">How grading works</Link>
          <Link href="/shop/orders">My orders</Link>
        </div>
      </div>
      {home.listedCount === 0 ? (
        <EmptyPanel title="Nothing listed yet">
          <p>New devices appear here as soon as they pass inspection. Check back soon.</p>
        </EmptyPanel>
      ) : (
        <>
          <h2>Just listed</h2>
          <ListingGrid cards={home.newest} />
          {home.gradeA.length > 0 && (
            <>
              <h2>Grade A picks</h2>
              <ListingGrid cards={home.gradeA} />
            </>
          )}
        </>
      )}
    </section>
  );
}

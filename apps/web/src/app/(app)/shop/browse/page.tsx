// B-02: browse with filters (all filters live in the URL).
import type { ShopCatalogueView } from "@certibuy/contracts";
import Link from "next/link";
import type { z } from "zod";
import { EmptyPanel } from "@/components/common/ui";
import { ListingGrid } from "@/components/shop/ListingCard";
import { loadView } from "@/server/views";

const KEYS = [
  "q",
  "category",
  "brand",
  "grade",
  "storage",
  "priceMin",
  "priceMax",
  "warrantyOnly",
  "sort",
] as const;

export default async function BrowsePage(props: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await props.searchParams;
  const filters = Object.fromEntries(KEYS.filter((k) => sp[k]).map((k) => [k, sp[k] as string]));
  const cat = await loadView<z.infer<typeof ShopCatalogueView>>("getShopCatalogue", filters);

  return (
    <section className="stack">
      <h1>Browse certified devices</h1>
      <form className="surface panel filters" method="get">
        <label className="field">
          <span className="field-label">Search</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="e.g. iPhone" />
        </label>
        <label className="field">
          <span className="field-label">Category</span>
          <select name="category" defaultValue={sp.category ?? ""}>
            <option value="">Any</option>
            {cat.facets.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Brand</span>
          <select name="brand" defaultValue={sp.brand ?? ""}>
            <option value="">Any</option>
            {cat.facets.brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Grade</span>
          <select name="grade" defaultValue={sp.grade ?? ""}>
            <option value="">Any</option>
            {["A", "B", "C", "D"].map((g) => (
              <option key={g} value={g}>
                Grade {g}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Storage</span>
          <select name="storage" defaultValue={sp.storage ?? ""}>
            <option value="">Any</option>
            {cat.facets.storages.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Max price (₹)</span>
          <input name="priceMax" inputMode="numeric" defaultValue={sp.priceMax ?? ""} />
        </label>
        <label className="field">
          <span className="field-label">Sort</span>
          <select name="sort" defaultValue={sp.sort ?? "newest"}>
            <option value="newest">Newest</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="grade">Best grade first</option>
          </select>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            name="warrantyOnly"
            value="1"
            defaultChecked={sp.warrantyOnly === "1"}
          />
          <span>With warranty only</span>
        </label>
        <div className="row">
          <button type="submit" className="button primary">
            Apply
          </button>
          <Link href="/shop/browse">Clear</Link>
        </div>
      </form>
      <p className="meta" aria-live="polite">
        {cat.total} {cat.total === 1 ? "device" : "devices"}
      </p>
      {cat.total === 0 ? (
        <EmptyPanel title="No devices match">
          <p>Try widening the filters or clearing the search.</p>
        </EmptyPanel>
      ) : (
        <ListingGrid cards={cat.items} />
      )}
    </section>
  );
}

// O-03 catalogue: add and edit device models (prices are integer rupees).
import type { CatalogueView } from "@certibuy/application";
import { CATEGORY } from "@certibuy/contracts";
import { formatInr } from "@certibuy/domain";
import type { z } from "zod";
import { EmptyPanel } from "@/components/common/ui";
import CommandForm, { type FieldSpec } from "@/components/ops/CommandForm";
import { loadView } from "@/server/views";

type Model = z.infer<typeof CatalogueView>["models"][number];

function fields(m?: Model): FieldSpec[] {
  return [
    { name: "brand", label: "Brand", kind: "text", required: true, defaultValue: m?.brand },
    { name: "model", label: "Model", kind: "text", required: true, defaultValue: m?.model },
    { name: "storage", label: "Storage", kind: "text", required: true, defaultValue: m?.storage },
    {
      name: "category",
      label: "Category",
      kind: "select",
      options: CATEGORY.options.map((c) => ({ value: c, label: c })),
      defaultValue: m?.category ?? "phone",
    },
    {
      name: "colours",
      label: "Colours (comma separated)",
      kind: "list",
      defaultValue: m?.colours.join(", "),
    },
    {
      name: "launchDate",
      label: "Launch date",
      kind: "date",
      nullable: true,
      defaultValue: m?.launchDate,
    },
    {
      name: "successorLaunchDate",
      label: "Successor launch",
      kind: "date",
      nullable: true,
      defaultValue: m?.successorLaunchDate,
    },
    {
      name: "originalPrice",
      label: "Original price (₹)",
      kind: "optionalNumber",
      step: "1",
      defaultValue: m?.originalPrice,
    },
    {
      name: "marketPriceA",
      label: "Grade A price (₹)",
      kind: "number",
      step: "1",
      required: true,
      defaultValue: m?.marketPriceA,
    },
    {
      name: "marketPriceB",
      label: "Grade B price (₹)",
      kind: "optionalNumber",
      step: "1",
      defaultValue: m?.marketPriceB,
    },
    {
      name: "marketPriceC",
      label: "Grade C price (₹)",
      kind: "optionalNumber",
      step: "1",
      defaultValue: m?.marketPriceC,
    },
    {
      name: "marketPriceD",
      label: "Grade D price (₹)",
      kind: "optionalNumber",
      step: "1",
      defaultValue: m?.marketPriceD,
    },
    {
      name: "b2bFloorPrice",
      label: "B2B floor (₹)",
      kind: "number",
      step: "1",
      required: true,
      defaultValue: m?.b2bFloorPrice,
    },
    {
      name: "liquidityTier",
      label: "Liquidity tier",
      kind: "select",
      options: ["high", "medium", "low"].map((t) => ({ value: t, label: t })),
      defaultValue: m?.liquidityTier ?? "medium",
    },
    {
      name: "priceIsPlaceholder",
      label: "Prices are placeholders",
      kind: "checkbox",
      defaultValue: m?.priceIsPlaceholder ?? true,
    },
    { name: "active", label: "Active", kind: "checkbox", defaultValue: m?.active ?? true },
  ];
}

export default async function CataloguePage() {
  const { models } = await loadView<z.infer<typeof CatalogueView>>("getCatalogue");
  return (
    <section className="stack">
      <h1>Catalogue</h1>
      <details className="surface panel">
        <summary className="field-label">Add a model</summary>
        <CommandForm name="saveDeviceModel" fields={fields()} submitLabel="Add model" />
      </details>
      {models.length === 0 ? (
        <EmptyPanel title="No models yet" />
      ) : (
        models.map((m) => (
          <details key={m.id} className="surface panel">
            <summary>
              <span className="field-label">
                {m.brand} {m.model} {m.storage}
              </span>{" "}
              <span className="meta">
                A {formatInr(m.marketPriceA)} · floor {formatInr(m.b2bFloorPrice)} ·{" "}
                {m.liquidityTier}
                {m.active ? "" : " · inactive"}
                {m.icPaused ? " · Instant Cash paused" : ""}
              </span>
            </summary>
            <CommandForm
              name="saveDeviceModel"
              fixed={{ id: m.id }}
              fields={fields(m)}
              submitLabel="Save changes"
            />
          </details>
        ))
      )}
    </section>
  );
}

// S-02: model picker.
import type { SellCatalogueView } from "@certibuy/contracts";
import type { z } from "zod";
import ModelPicker from "@/components/seller/ModelPicker";
import StepRail from "@/components/seller/StepRail";
import { loadView } from "@/server/views";

export default async function SellPage() {
  const { models } = await loadView<z.infer<typeof SellCatalogueView>>("getSellCatalogue");
  return (
    <section className="stack narrow">
      <StepRail current="details" />
      <h1>Which device are you selling?</h1>
      <ModelPicker models={models} />
    </section>
  );
}

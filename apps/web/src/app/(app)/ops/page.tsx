import AreaPlaceholder from "@/components/common/AreaPlaceholder";

export default function Page() {
  return (
    <AreaPlaceholder
      title="Operations console"
      intro="Catalogue, pricing, inventory, exceptions, jobs and metrics."
      phase="Phases 6 and 7"
      coming={[
        "Overview, alerts and jobs (O-01, O-02, O-12)",
        "Catalogue, pricing, liquidity and inventory (O-03 to O-06)",
        "Exceptions, hubs, users, support, audit and metrics (O-07 to O-15)",
      ]}
    />
  );
}

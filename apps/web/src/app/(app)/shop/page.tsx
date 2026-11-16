import AreaPlaceholder from "@/components/common/AreaPlaceholder";

export default function Page() {
  return (
    <AreaPlaceholder
      title="Shop certified devices"
      intro="Every device was inspected and graded by CertiBuy and is held in our custody."
      phase="Phase 5"
      coming={[
        "Shop home, browse and filters (B-01, B-02)",
        "Listing detail with the inspection report (B-03)",
        "Checkout, orders, cancellation and returns (B-05 to B-12)",
      ]}
    />
  );
}

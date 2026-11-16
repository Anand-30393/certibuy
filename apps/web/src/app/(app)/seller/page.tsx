import AreaPlaceholder from "@/components/common/AreaPlaceholder";

export default function Page() {
  return (
    <AreaPlaceholder
      title="Sell a device"
      intro="Get an offer in minutes, book a hub slot and track every payout."
      phase="Phase 3"
      coming={[
        "Sell landing and your deals (S-01)",
        "Model picker and the selling wizard (S-02 to S-12)",
        "Deal tracker and payout history (S-11, S-13)",
      ]}
    />
  );
}

import AreaPlaceholder from "@/components/common/AreaPlaceholder";

export default function Page() {
  return (
    <AreaPlaceholder
      title="Profile"
      intro="Your details, payout account and delivery address."
      phase="Phase 3"
      coming={["Name, phone, city and avatar (X-06)", "Payout account and delivery address"]}
    />
  );
}

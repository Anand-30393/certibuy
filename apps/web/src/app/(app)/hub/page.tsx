import AreaPlaceholder from "@/components/common/AreaPlaceholder";

export default function Page() {
  return (
    <AreaPlaceholder
      title="Hub counter"
      intro="Today's bookings for your hub, identity checks, grading and handover."
      phase="Phase 4"
      coming={[
        "Hub queue (T-01)",
        "Identity, checklist, grade and decision (T-02 to T-05)",
        "Handover and return re-inspection (T-06, T-08)",
      ]}
    />
  );
}

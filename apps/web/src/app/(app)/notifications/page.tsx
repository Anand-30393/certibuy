import AreaPlaceholder from "@/components/common/AreaPlaceholder";

export default function Page() {
  return (
    <AreaPlaceholder
      title="Notifications"
      intro="Updates about your deals, orders and payouts."
      phase="Phase 6"
      coming={["Notification list with unread filter (X-04)", "Mark one or all as read"]}
    />
  );
}

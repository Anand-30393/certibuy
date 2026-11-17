// O-08 hubs: slots, daily capacity and status.
import type { HubsBoardView } from "@certibuy/application";
import type { z } from "zod";
import { EmptyPanel } from "@/components/common/ui";
import CommandForm, { type FieldSpec } from "@/components/ops/CommandForm";
import { loadView } from "@/server/views";

type Hub = z.infer<typeof HubsBoardView>["hubs"][number];

function fields(h?: Hub): FieldSpec[] {
  return [
    { name: "name", label: "Name", kind: "text", required: true, defaultValue: h?.name },
    {
      name: "type",
      label: "Type",
      kind: "select",
      options: [
        { value: "flagship", label: "Flagship" },
        { value: "partner", label: "Partner" },
      ],
      defaultValue: h?.type ?? "partner",
    },
    { name: "address", label: "Address", kind: "text", required: true, defaultValue: h?.address },
    { name: "city", label: "City", kind: "text", required: true, defaultValue: h?.city },
    { name: "pincode", label: "Pincode", kind: "text", required: true, defaultValue: h?.pincode },
    {
      name: "slotTimes",
      label: "Slot times (HH:MM, comma separated)",
      kind: "list",
      defaultValue: h?.slotTimes.join(", ") ?? "10:00, 12:00, 15:00, 17:00",
    },
    {
      name: "dailyCapacity",
      label: "Daily capacity",
      kind: "number",
      step: "1",
      defaultValue: h?.dailyCapacity ?? 20,
    },
    {
      name: "distanceKm",
      label: "Distance (km)",
      kind: "optionalNumber",
      defaultValue: h?.distanceKm,
    },
    { name: "active", label: "Active", kind: "checkbox", defaultValue: h?.active ?? true },
  ];
}

export default async function HubsPage() {
  const { hubs } = await loadView<z.infer<typeof HubsBoardView>>("getHubsBoard");
  return (
    <section className="stack">
      <h1>Hubs</h1>
      <details className="surface panel">
        <summary className="field-label">Add a hub</summary>
        <CommandForm name="saveHub" fields={fields()} submitLabel="Add hub" />
      </details>
      {hubs.length === 0 ? (
        <EmptyPanel title="No hubs yet" />
      ) : (
        hubs.map((h) => (
          <details key={h.id} className="surface panel">
            <summary>
              <span className="field-label">{h.name}</span>{" "}
              <span className="meta">
                {h.city} · {h.bookingsToday}/{h.dailyCapacity} today · {h.technicians} technicians
                {h.active ? "" : " · inactive"}
              </span>
            </summary>
            <CommandForm
              name="saveHub"
              fixed={{ id: h.id }}
              fields={fields(h)}
              submitLabel="Save hub"
            />
          </details>
        ))
      )}
    </section>
  );
}

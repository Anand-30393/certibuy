// O-04 business settings: every business number, validated, versioned with history.
import type { PricingBoardView } from "@certibuy/application";
import type { z } from "zod";
import { EmptyPanel } from "@/components/common/ui";
import CommandForm from "@/components/ops/CommandForm";
import { loadView } from "@/server/views";

const label = (k: string) => k.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

export default async function PricingPage() {
  const b = await loadView<z.infer<typeof PricingBoardView>>("getPricingBoard");
  return (
    <section className="stack">
      <h1>Business settings</h1>
      <p className="meta">
        Version {b.version}. Changes apply to new offers, listings and jobs; existing deals keep the
        numbers they were made with. The demo clock lives under Jobs.
      </p>
      <div className="surface panel">
        <CommandForm
          name="savePricingSettings"
          wrap="changes"
          fields={b.editable.map((k) => ({
            name: k,
            label: label(k),
            kind: "number",
            defaultValue: b.settings[k] ?? 0,
          }))}
          submitLabel="Save settings"
          confirm="Save these business settings? The change is recorded in the audit log."
        />
      </div>
      <h2>History</h2>
      {b.history.length === 0 ? (
        <EmptyPanel title="No changes yet" />
      ) : (
        <ul className="list">
          {b.history.map((h) => (
            <li key={h.version} className="surface panel">
              <p className="field-label">
                v{h.version} · {h.by} ·{" "}
                {new Date(h.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
              </p>
              <p className="meta">{h.changes}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

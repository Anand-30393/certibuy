// B-04: grade guide (battery floors read from Settings).
import type { WorkspaceContext } from "@certibuy/contracts";
import { GradeChip } from "@/components/common/ui";
import { loadView } from "@/server/views";

export default async function GradesPage() {
  const ws = await loadView<WorkspaceContext>("getWorkspaceContext");
  const s = ws.settings as Record<string, number>;
  const rows = [
    [
      "A",
      "Like new: no visible marks.",
      `Battery at least ${s.battery_a_min}%`,
      `${s.warranty_months}-month warranty`,
    ],
    [
      "B",
      "Light wear: faint marks you notice up close.",
      `Battery at least ${s.battery_b_min}%`,
      `${s.warranty_months}-month warranty`,
    ],
    [
      "C",
      "Visible wear: scratches or small dents; everything works.",
      `Battery at least ${s.battery_c_min}%`,
      `${s.warranty_months}-month warranty`,
    ],
    [
      "D",
      "Heavy wear: refurbished by CertiBuy before sale.",
      "Battery may be below the grade C floor",
      "No warranty",
    ],
  ];
  return (
    <section className="stack narrow">
      <h1>How grading works</h1>
      <p>
        A CertiBuy technician inspects every device in person. The final grade is the worst of three
        checks: battery, cosmetic condition and a 9-point function checklist.
      </p>
      <ul className="list">
        {rows.map(([g, text, battery, warranty]) => (
          <li key={g} className="surface list-row">
            <GradeChip grade={g as string} />
            <span>{text}</span>
            <span className="meta">
              {battery} · {warranty}
            </span>
          </li>
        ))}
      </ul>
      <p className="meta">
        A second-year warranty is available at checkout for {s.warranty_addon_pct}% of the price
        (not on grade D).
      </p>
    </section>
  );
}

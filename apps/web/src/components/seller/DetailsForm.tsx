"use client";

// S-03: tiles, not free text — except the IMEI (validated with Luhn in the browser and again on
// the server, because the browser is not a trust boundary).
import type { SubmissionViewT } from "@certibuy/contracts";
import { isValidImei } from "@certibuy/domain";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { command } from "@/lib/api";

type Option<T extends string | number | boolean> = { value: T; label: string; hint?: string };

function Pills<T extends string | number | boolean>(props: {
  label: string;
  options: Option<T>[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="field">
      <legend className="field-label">{props.label}</legend>
      <div className="chip-row">
        {props.options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            className="pill"
            aria-pressed={props.value === o.value}
            onClick={() => props.onChange(o.value)}
            title={o.hint}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

const COSMETIC: Option<"A" | "B" | "C" | "D">[] = [
  { value: "A", label: "Like new", hint: "No visible marks" },
  { value: "B", label: "Light wear", hint: "Faint marks you see up close" },
  { value: "C", label: "Visible wear", hint: "Scratches or small dents" },
  { value: "D", label: "Heavy wear", hint: "Deep scratches, dents or cracks" },
];
const REPAIRED: Option<"no" | "authorised" | "other_shop" | "not_sure">[] = [
  { value: "no", label: "Never repaired" },
  { value: "authorised", label: "Authorised service centre" },
  { value: "other_shop", label: "Another repair shop" },
  { value: "not_sure", label: "Not sure" },
];
const BILL_BOX: Option<"bill_and_box" | "bill_only" | "box_only" | "neither">[] = [
  { value: "bill_and_box", label: "Bill and box" },
  { value: "bill_only", label: "Bill only" },
  { value: "box_only", label: "Box only" },
  { value: "neither", label: "Neither" },
];
const WARRANTY: Option<"in_warranty" | "expired" | "unknown">[] = [
  { value: "in_warranty", label: "In warranty" },
  { value: "expired", label: "Expired" },
  { value: "unknown", label: "Not sure" },
];
const AGE: Option<number>[] = [
  { value: 6, label: "Under 6 months" },
  { value: 12, label: "6–12 months" },
  { value: 24, label: "1–2 years" },
  { value: 36, label: "Over 2 years" },
];

export default function DetailsForm({ sub }: { sub: SubmissionViewT }) {
  const router = useRouter();
  const d = sub.details;
  const [colour, setColour] = useState(d.colour ?? sub.model.colours[0] ?? "");
  const [imei, setImei] = useState(d.imei ?? "");
  const [age, setAge] = useState<number | null>(d.ageMonths);
  const [cosmetic, setCosmetic] = useState(d.declaredCosmetic);
  const [repaired, setRepaired] = useState(d.repaired);
  const [water, setWater] = useState<boolean | null>(d.waterExposure);
  const [billBox, setBillBox] = useState(d.billBox);
  const [warranty, setWarranty] = useState(d.warrantyStatus);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const imeiHint =
    imei.length === 0
      ? "Dial *#06# to see it, or check the box."
      : !/^\d*$/.test(imei)
        ? "Use digits only."
        : imei.length < 15
          ? `${15 - imei.length} more digits.`
          : isValidImei(imei)
            ? "Looks right."
            : "That IMEI isn't valid. Check the 15 digits and enter them again.";

  async function save() {
    if (!isValidImei(imei)) return setError("Enter a valid 15-digit IMEI.");
    if (age === null || !cosmetic || !repaired || water === null || !billBox || !warranty) {
      return setError("Answer every question to continue.");
    }
    setBusy(true);
    setError(null);
    try {
      const r = await command<{ next: string }>("saveSubmissionDetails", {
        submissionId: sub.id,
        colour,
        imei,
        ageMonths: age,
        declaredCosmetic: cosmetic,
        repaired,
        waterExposure: water,
        billBox,
        warrantyStatus: warranty,
      });
      router.push(r.next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <Pills
        label="Colour"
        options={sub.model.colours.map((c) => ({ value: c, label: c }))}
        value={colour}
        onChange={setColour}
      />
      <label className="field">
        <span className="field-label">IMEI</span>
        <input
          inputMode="numeric"
          maxLength={15}
          value={imei}
          onChange={(e) => setImei(e.target.value.replace(/\s/g, ""))}
          aria-describedby="imei-hint"
        />
        <span id="imei-hint" className="meta">
          {imeiHint}
        </span>
      </label>
      <Pills label="How old is it?" options={AGE} value={age} onChange={setAge} />
      <Pills label="Condition" options={COSMETIC} value={cosmetic} onChange={setCosmetic} />
      <Pills label="Repair history" options={REPAIRED} value={repaired} onChange={setRepaired} />
      <Pills
        label="Has it ever been exposed to water?"
        options={[
          { value: false, label: "No" },
          { value: true, label: "Yes" },
        ]}
        value={water}
        onChange={setWater}
      />
      <Pills label="Accessories" options={BILL_BOX} value={billBox} onChange={setBillBox} />
      <Pills
        label="Manufacturer warranty"
        options={WARRANTY}
        value={warranty}
        onChange={setWarranty}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="sticky-footer">
        <button type="button" className="button primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Continue to photos"}
        </button>
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { command } from "@/lib/api";

/** Serializable field description so Server Components can declare ops forms. */
export type FieldSpec = {
  name: string;
  label: string;
  kind: "text" | "number" | "optionalNumber" | "textarea" | "select" | "checkbox" | "date" | "list";
  options?: { value: string; label: string }[];
  defaultValue?: string | number | boolean | null | undefined;
  required?: boolean;
  /** Empty input is sent as null (text, select, date). */
  nullable?: boolean;
  /** Empty input is left out of the body. */
  optional?: boolean;
  step?: string;
};

function read(f: FormData, spec: FieldSpec): unknown {
  if (spec.kind === "checkbox") return f.get(spec.name) === "on";
  const raw = String(f.get(spec.name) ?? "").trim();
  if (spec.kind === "list")
    return raw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  if (spec.kind === "number") return Number(raw);
  if (spec.kind === "optionalNumber") return raw === "" ? null : Number(raw);
  if (raw === "") return spec.nullable ? null : spec.optional ? undefined : "";
  return raw;
}

/** An ops form that posts to one command, refreshes the page and shows the server's message. */
export default function CommandForm(props: {
  name: string;
  fields: FieldSpec[];
  fixed?: Record<string, unknown>;
  /** Nest the field values under this key (e.g. `changes`). */
  wrap?: string;
  submitLabel: string;
  confirm?: string;
  resultKey?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (props.confirm && !window.confirm(props.confirm)) return;
    const f = new FormData(e.currentTarget);
    const values: Record<string, unknown> = {};
    for (const spec of props.fields) {
      const v = read(f, spec);
      if (v !== undefined) values[spec.name] = v;
    }
    const body = props.wrap
      ? { ...props.fixed, [props.wrap]: values }
      : { ...props.fixed, ...values };
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await command<Record<string, unknown>>(props.name, body);
      setDone(props.resultKey ? String(res[props.resultKey] ?? "") : "Saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={props.compact ? "row form-compact" : "stack"} onSubmit={onSubmit}>
      <div className={props.compact ? "row" : "form-grid"}>
        {props.fields.map((s) => (
          <Field key={s.name} spec={s} />
        ))}
      </div>
      <div className="row">
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? "Working…" : props.submitLabel}
        </button>
        {error && (
          <span className="form-error" role="alert">
            {error}
          </span>
        )}
        {done && !props.resultKey && (
          <span className="form-notice" role="status">
            {done}
          </span>
        )}
      </div>
      {done && props.resultKey && (
        <label className="field">
          <span className="field-label">Copy this link and send it to the person</span>
          <input readOnly value={done} onFocus={(e) => e.currentTarget.select()} />
        </label>
      )}
    </form>
  );
}

function Field({ spec: s }: { spec: FieldSpec }) {
  const dv = s.defaultValue;
  if (s.kind === "checkbox") {
    return (
      <label className="check">
        <input type="checkbox" name={s.name} defaultChecked={Boolean(dv)} /> {s.label}
      </label>
    );
  }
  return (
    <label className="field">
      <span className="field-label">{s.label}</span>
      {s.kind === "textarea" ? (
        <textarea
          name={s.name}
          defaultValue={dv == null ? "" : String(dv)}
          required={s.required}
          rows={3}
        />
      ) : s.kind === "select" ? (
        <select name={s.name} defaultValue={dv == null ? "" : String(dv)} required={s.required}>
          {s.nullable && <option value="">—</option>}
          {s.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          name={s.name}
          type={
            s.kind === "date"
              ? "date"
              : s.kind === "number" || s.kind === "optionalNumber"
                ? "number"
                : "text"
          }
          step={s.step ?? (s.kind === "number" || s.kind === "optionalNumber" ? "any" : undefined)}
          defaultValue={dv == null ? "" : Array.isArray(dv) ? dv.join(", ") : String(dv)}
          required={s.required}
        />
      )}
    </label>
  );
}

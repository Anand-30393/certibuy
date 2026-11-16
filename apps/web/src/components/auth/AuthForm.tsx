"use client";

import type { FormEvent, ReactNode } from "react";

/** Shared shell for the auth forms: one primary action, inline error and status messages. */
export default function AuthForm(props: {
  title: string;
  onSubmit: (form: FormData) => Promise<void>;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  notice?: string | null;
  children: ReactNode;
  footer?: ReactNode;
}) {
  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await props.onSubmit(new FormData(e.currentTarget));
  }
  return (
    <form onSubmit={handle} className="stack" noValidate>
      <h1>{props.title}</h1>
      {props.children}
      {props.error && (
        <p className="form-error" role="alert">
          {props.error}
        </p>
      )}
      {props.notice && (
        <p className="form-notice" role="status">
          {props.notice}
        </p>
      )}
      <button type="submit" className="button primary" disabled={props.busy}>
        {props.busy ? "Please wait…" : props.submitLabel}
      </button>
      {props.footer && <div className="meta">{props.footer}</div>}
    </form>
  );
}

export function Field(props: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  inputMode?: "numeric" | "email" | "text";
}) {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      <input
        name={props.name}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete}
        required={props.required ?? true}
        inputMode={props.inputMode}
      />
    </label>
  );
}

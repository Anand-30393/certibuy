"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { command } from "@/lib/api";

/** One ops action: runs a command, refreshes the page, shows the server's message on failure. */
export default function OpsCommandButton(props: {
  name: string;
  body: Record<string, unknown>;
  label: string;
  disabled?: boolean;
  confirm?: string | undefined;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (props.confirm && !window.confirm(props.confirm)) return;
    setBusy(true);
    setError(null);
    try {
      await command(props.name, props.body);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="stack">
      <button type="button" className="button" disabled={busy || props.disabled} onClick={run}>
        {busy ? "Working…" : props.label}
      </button>
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

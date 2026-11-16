"use client";

import type { SellCatalogueView } from "@certibuy/contracts";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { z } from "zod";
import { command } from "@/lib/api";

type Model = z.infer<typeof SellCatalogueView>["models"][number];

export default function ModelPicker({ models }: { models: Model[] }) {
  const router = useRouter();
  const [brand, setBrand] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const brands = useMemo(() => [...new Set(models.map((m) => m.brand))], [models]);
  const shown = models.filter(
    (m) =>
      (!brand || m.brand === brand) &&
      `${m.brand} ${m.model} ${m.storage}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  async function pick(id: string) {
    setBusy(id);
    setError(null);
    try {
      const r = await command<{ next: string }>("createSubmission", { deviceModelId: id });
      router.push(r.next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <label className="field">
        <span className="field-label">Search</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. iPhone 14"
        />
      </label>
      <div className="chip-row" role="group" aria-label="Brand">
        <button
          type="button"
          className="pill"
          aria-pressed={brand === null}
          onClick={() => setBrand(null)}
        >
          All brands
        </button>
        {brands.map((b) => (
          <button
            key={b}
            type="button"
            className="pill"
            aria-pressed={brand === b}
            onClick={() => setBrand(b)}
          >
            {b}
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="meta">No models match. Try a different search or brand.</p>
      ) : (
        <div className="tile-grid">
          {shown.map((m) => (
            <button
              key={m.id}
              type="button"
              className="tile surface"
              disabled={!m.selectable || busy !== null}
              onClick={() => pick(m.id)}
            >
              <span className="tile-title">
                {m.brand} {m.model}
              </span>
              <span className="meta">
                {m.storage} · {m.category}
              </span>
              {m.reason && <span className="meta">{m.reason}</span>}
              {busy === m.id && <span className="meta">Starting…</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

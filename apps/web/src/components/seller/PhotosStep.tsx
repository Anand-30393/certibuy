"use client";

import type { SubmissionViewT } from "@certibuy/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { command } from "@/lib/api";
import { checkPhoto } from "@/lib/photo";

type Shot = SubmissionViewT["photos"][number];

function ShotCard(props: {
  submissionId: string;
  shot: Shot;
  rules: SubmissionViewT["photoRules"];
  onDone: () => void;
}) {
  const [state, setState] = useState<"idle" | "checking" | "uploading">("idle");
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(0);
  const [preview, setPreview] = useState<string | null>(props.shot.url);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setState("checking");
    const check = await checkPhoto(file, props.rules);
    if (!check.ok) {
      setFailed((n) => n + 1);
      setError(check.reason);
      setState("idle");
      return;
    }
    setState("uploading");
    try {
      const up = await command<{ signedUrl: string; path: string }>("requestPhotoUpload", {
        submissionId: props.submissionId,
        key: props.shot.key,
      });
      const res = await fetch(up.signedUrl, {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body: check.blob,
      });
      if (!res.ok)
        throw new Error("The upload didn't go through. Check your connection and retry.");
      await command("confirmPhoto", {
        submissionId: props.submissionId,
        key: props.shot.key,
        path: up.path,
        brightness: check.brightness,
        failedAttempts: failed,
      });
      setFailed(0);
      setPreview(URL.createObjectURL(check.blob));
      props.onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The upload didn't go through. Try again.");
    } finally {
      setState("idle");
    }
  }

  return (
    <div className="surface shot-card">
      {preview ? (
        <img src={preview} alt={`${props.shot.label} preview`} className="shot-preview" />
      ) : (
        <div className="shot-preview placeholder" aria-hidden="true" />
      )}
      <p className="field-label">{props.shot.label}</p>
      <p className="meta">{props.shot.tip}</p>
      <label className="button">
        {state === "checking"
          ? "Checking…"
          : state === "uploading"
            ? "Uploading…"
            : preview
              ? "Retake"
              : "Take photo"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={state !== "idle"}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default function PhotosStep({ sub }: { sub: SubmissionViewT }) {
  const router = useRouter();
  const [done, setDone] = useState(
    () => new Set(sub.photos.filter((p) => p.uploaded).map((p) => p.key)),
  );
  const complete = sub.photos.every((p) => done.has(p.key));

  return (
    <div className="stack">
      <div className="shot-grid">
        {sub.photos.map((shot) => (
          <ShotCard
            key={shot.key}
            submissionId={sub.id}
            shot={shot}
            rules={sub.photoRules}
            onDone={() => setDone((s) => new Set(s).add(shot.key))}
          />
        ))}
      </div>
      <p className="meta" aria-live="polite">
        {done.size} of {sub.photos.length} photos added.
      </p>
      <div className="sticky-footer">
        <button
          type="button"
          className="button primary"
          disabled={!complete}
          onClick={() => router.push(`/seller/sell/${sub.id}/diagnostics`)}
        >
          Continue to device checks
        </button>
      </div>
    </div>
  );
}

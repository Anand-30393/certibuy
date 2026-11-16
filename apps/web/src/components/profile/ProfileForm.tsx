"use client";

import type { ProfileView } from "@certibuy/contracts";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { z } from "zod";
import { command } from "@/lib/api";

export default function ProfileForm({ profile }: { profile: z.infer<typeof ProfileView> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await command("updateProfile", {
        fullName: String(f.get("fullName") ?? ""),
        phone: String(f.get("phone") ?? ""),
        city: String(f.get("city") ?? ""),
        payoutAccount: String(f.get("payoutAccount") ?? ""),
        deliveryAddress: String(f.get("deliveryAddress") ?? ""),
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <p className="meta">Signed in as {profile.email}</p>
      <label className="field">
        <span className="field-label">Full name</span>
        <input name="fullName" defaultValue={profile.fullName} autoComplete="name" required />
      </label>
      <label className="field">
        <span className="field-label">Mobile number</span>
        <input name="phone" defaultValue={profile.phone} inputMode="tel" autoComplete="tel" />
      </label>
      <label className="field">
        <span className="field-label">City</span>
        <input name="city" defaultValue={profile.city} autoComplete="address-level2" />
      </label>
      <label className="field">
        <span className="field-label">Payout account (UPI ID or bank reference)</span>
        <input name="payoutAccount" defaultValue={profile.payoutAccount} />
      </label>
      <label className="field">
        <span className="field-label">Delivery address</span>
        <textarea
          name="deliveryAddress"
          defaultValue={profile.deliveryAddress}
          rows={3}
          autoComplete="street-address"
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="form-notice" role="status">
          Profile saved.
        </p>
      )}
      <button type="submit" className="button primary" disabled={busy}>
        {busy ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}

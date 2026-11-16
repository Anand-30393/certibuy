"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setActiveMode } from "@/lib/api";

/** One-time chooser for a customer with no saved mode. They can switch any time from the header. */
export default function ModeChooser() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function choose(mode: "buyer" | "seller") {
    try {
      router.replace(await setActiveMode(mode));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    }
  }

  return (
    <section className="stack">
      <h1>What would you like to do first?</h1>
      <p>You can buy and sell with the same account and switch at any time.</p>
      <div className="tile-grid">
        <button type="button" className="tile surface" onClick={() => choose("buyer")}>
          <span className="tile-title">Buy a certified device</span>
          <span className="meta">Inspected, graded and held by CertiBuy, with a warranty.</span>
        </button>
        <button type="button" className="tile surface" onClick={() => choose("seller")}>
          <span className="tile-title">Sell a device</span>
          <span className="meta">Get an offer in minutes and get paid at the hub counter.</span>
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

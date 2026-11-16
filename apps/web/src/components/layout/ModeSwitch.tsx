"use client";

import type { ActiveMode } from "@certibuy/contracts";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { setActiveMode } from "@/lib/api";

/** A customer's buying/selling switch. A view preference only — never a permission. */
export default function ModeSwitch() {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const current: ActiveMode | null = pathname.startsWith("/seller")
    ? "seller"
    : pathname.startsWith("/shop")
      ? "buyer"
      : null;

  async function choose(mode: ActiveMode) {
    setBusy(true);
    try {
      router.push(await setActiveMode(mode));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mode-switch" role="group" aria-label="Buying or selling">
      {(["buyer", "seller"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={current === mode}
          disabled={busy}
          onClick={() => choose(mode)}
        >
          {mode === "buyer" ? "Buying" : "Selling"}
        </button>
      ))}
    </div>
  );
}

"use client";

import { useSearchParams } from "next/navigation";

/** Shown after the route guard bounced the visitor to their own home (roles.md.txt §4). */
export default function DeniedNotice() {
  const params = useSearchParams();
  if (params.get("denied") !== "1") return null;
  return (
    <p className="notice" role="status">
      That page is for another role, so we brought you to your home page.
    </p>
  );
}

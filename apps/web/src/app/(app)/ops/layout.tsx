import type { ReactNode } from "react";
import OpsNav from "@/components/ops/OpsNav";
import { guardArea } from "@/server/context";

export default async function AreaLayout({ children }: { children: ReactNode }) {
  await guardArea("ops", "/ops");
  return (
    <div className="ops-shell">
      <OpsNav />
      <div className="ops-main">{children}</div>
    </div>
  );
}

// Signed-in shell: verifies the session, loads the workspace context and renders the header.
import { dispatch, INTEGRATION_MODES, meFor, views } from "@certibuy/application";
import type { WorkspaceContext } from "@certibuy/contracts";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import AppShell from "@/components/layout/AppShell";
import { buildContext } from "@/server/context";

export const dynamic = "force-dynamic";

export default async function SignedInLayout({ children }: { children: ReactNode }) {
  const ctx = await buildContext();
  if (!ctx.actor) redirect("/login");
  const workspace = (await dispatch(views, "getWorkspaceContext", ctx, {})) as WorkspaceContext;
  const simulated = Object.values(INTEGRATION_MODES).some((m) => m === "simulated");

  return (
    <AppShell
      me={meFor(ctx.actor, ctx.env.requireStaffMfa)}
      businessDate={workspace.businessDate}
      demoMode={workspace.demoMode}
      simulated={simulated}
    >
      {children}
    </AppShell>
  );
}

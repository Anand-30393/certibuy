import {
  canOpenArea,
  homeFor,
  loadSettings,
  mfaSatisfied,
  type Actor,
  type AppContext,
} from "@certibuy/application";
import type { Area } from "@certibuy/contracts";
import { getPrisma } from "@certibuy/db";
import { createSimulatedMail, createSimulatedPayoutRail } from "@certibuy/integrations";
import { createSupabaseStorage } from "@certibuy/integrations/supabase";
import { redirect } from "next/navigation";
import { getActor } from "./actor";

export { safeReturnTo } from "@/lib/paths";

export function serverEnv(): AppContext["env"] {
  return {
    requireStaffMfa: process.env.REQUIRE_STAFF_MFA !== "false",
    demoToolsEnabled: process.env.DEMO_TOOLS_ENABLED === "true",
    appPublicUrl: process.env.APP_PUBLIC_URL ?? "http://localhost:3000",
  };
}

export async function buildContext(): Promise<AppContext> {
  return {
    db: getPrisma(),
    actor: await getActor(),
    now: new Date(),
    storage: createSupabaseStorage(),
    payouts: createSimulatedPayoutRail(),
    mail: createSimulatedMail(),
    env: serverEnv(),
  };
}

/**
 * Server-side route guard for an area (roles.md.txt §4). Wrong role → the caller's own home;
 * staff areas also require two-step verification when REQUIRE_STAFF_MFA is on.
 */
export async function guardArea(area: Area, path: string): Promise<Actor> {
  const ctx = await buildContext();
  const actor = ctx.actor;
  if (!actor) redirect(`/login?returnTo=${encodeURIComponent(path)}`);

  const settings = await loadSettings(ctx.db);
  if (!canOpenArea(actor, area, { demoMode: settings.demo_mode })) {
    redirect(`${homeFor(actor)}?denied=1`);
  }
  if ((area === "hub" || area === "ops") && !mfaSatisfied(actor, ctx.env.requireStaffMfa)) {
    redirect(`/mfa?returnTo=${encodeURIComponent(path)}`);
  }
  return actor;
}

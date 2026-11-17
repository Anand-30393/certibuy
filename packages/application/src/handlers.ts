// Phase 2 commands and views. Later phases add selling, inspection, buying, returns and ops.
import {
  EmptyInput,
  MeOutput,
  SetActiveModeInput,
  SetActiveModeOutput,
  WorkspaceContextOutput,
} from "@certibuy/contracts";
import { businessDate } from "@certibuy/domain";
import type { Actor } from "./actor";
import { defineHandler, type AnyHandler } from "./registry";
import { homeFor, mfaSatisfied } from "./policies";
import { loadSettings } from "./settings";
import { sellingCommands, sellingViews } from "./selling/handlers";
import { hubCommands, hubViews } from "./hub/handlers";
import { buyingCommands, buyingViews } from "./buying/handlers";
import { jobCommands, jobViews } from "./jobs/handlers";

/** Every external effect is simulated in the capstone build (docs/architecture.md §12). */
export const INTEGRATION_MODES = {
  payments: "simulated",
  payouts: "simulated",
  courier: "simulated",
  grading: "simulated",
  mail: "simulated",
} as const;

export const getWorkspaceContext = defineHandler({
  auth: "signed_in",
  input: EmptyInput,
  output: WorkspaceContextOutput,
  async run(ctx) {
    const settings = await loadSettings(ctx.db);
    return {
      businessDate: businessDate(ctx.now, settings),
      demoMode: settings.demo_mode,
      settings: settings as unknown as Record<string, number | boolean>,
      integrations: INTEGRATION_MODES,
    };
  },
});

export function meFor(actor: Actor, requireStaffMfa: boolean) {
  return {
    userId: actor.userId,
    email: actor.email,
    fullName: actor.fullName,
    appRole: actor.appRole,
    activeMode: actor.activeMode,
    hubId: actor.hubId,
    isPlatformAdmin: actor.isPlatformAdmin,
    home: homeFor(actor),
    mfaSatisfied: mfaSatisfied(actor, requireStaffMfa),
  };
}

export const getMe = defineHandler({
  auth: "signed_in",
  input: EmptyInput,
  output: MeOutput,
  run: async (ctx) => meFor(ctx.actor, ctx.env.requireStaffMfa),
});

/** X-06 / roles.md §4: a customer switches the side of the app that opens first. */
export const setActiveMode = defineHandler({
  auth: ["customer"],
  input: SetActiveModeInput,
  output: SetActiveModeOutput,
  async run(ctx, input) {
    await ctx.db.profile.update({
      where: { id: ctx.actor.userId },
      data: { active_mode: input.mode },
    });
    return { ok: true as const, home: input.mode === "seller" ? "/seller" : "/shop" };
  },
});

export const views: Record<string, AnyHandler> = {
  getWorkspaceContext,
  getMe,
  ...sellingViews,
  ...hubViews,
  ...buyingViews,
  ...jobViews,
};

export const commands: Record<string, AnyHandler> = {
  setActiveMode,
  ...sellingCommands,
  ...hubCommands,
  ...buyingCommands,
  ...jobCommands,
};

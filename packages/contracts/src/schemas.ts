// Command inputs and view outputs (docs/api.md.txt). Unknown input fields are rejected;
// view outputs are parsed so only declared fields ever leave the server.
import { z } from "zod";
import { ACTIVE_MODES, APP_ROLES } from "./roles";

export const EmptyInput = z.object({}).strict();

// --- commands ---------------------------------------------------------------

export const SetActiveModeInput = z.object({ mode: z.enum(ACTIVE_MODES) }).strict();
export type SetActiveModeInput = z.infer<typeof SetActiveModeInput>;

export const SetActiveModeOutput = z.object({ ok: z.literal(true), home: z.string() });

// --- views ------------------------------------------------------------------

const IntegrationMode = z.enum(["simulated", "live"]);

export const WorkspaceContextOutput = z.object({
  businessDate: z.string(),
  demoMode: z.boolean(),
  settings: z.record(z.string(), z.union([z.number(), z.boolean()])),
  integrations: z.object({
    payments: IntegrationMode,
    payouts: IntegrationMode,
    courier: IntegrationMode,
    grading: IntegrationMode,
    mail: IntegrationMode,
  }),
});
export type WorkspaceContext = z.infer<typeof WorkspaceContextOutput>;

export const MeOutput = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  fullName: z.string().nullable(),
  appRole: z.enum(APP_ROLES),
  activeMode: z.enum(ACTIVE_MODES).nullable(),
  hubId: z.string().nullable(),
  isPlatformAdmin: z.boolean(),
  home: z.string(),
  mfaSatisfied: z.boolean(),
});
export type Me = z.infer<typeof MeOutput>;

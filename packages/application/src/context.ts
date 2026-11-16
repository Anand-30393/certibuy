import type { PrismaClient } from "@certibuy/db";
import type { Actor } from "./actor";

/** Everything a command, view or job receives. The clock is passed in, never read inside. */
export interface AppContext {
  db: PrismaClient;
  actor: Actor | null;
  now: Date;
  env: {
    requireStaffMfa: boolean;
    demoToolsEnabled: boolean;
  };
}

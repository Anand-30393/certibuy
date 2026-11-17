import type { PrismaClient } from "@certibuy/db";
import type { MailPort, PayoutRail, StoragePort } from "@certibuy/integrations";
import type { Actor } from "./actor";

/** Everything a command, view or job receives. The clock is passed in, never read inside. */
export interface AppContext {
  db: PrismaClient;
  actor: Actor | null;
  now: Date;
  storage: StoragePort;
  payouts: PayoutRail;
  mail: MailPort;
  env: {
    requireStaffMfa: boolean;
    demoToolsEnabled: boolean;
    /** Base URL used in email links (APP_PUBLIC_URL). */
    appPublicUrl: string;
  };
}

import type { ActiveMode, AppRole } from "@certibuy/contracts";

/** The signed-in caller, always re-read from `profiles` on each request (never from the browser). */
export interface Actor {
  userId: string;
  email: string | null;
  fullName: string | null;
  appRole: AppRole;
  activeMode: ActiveMode | null;
  hubId: string | null;
  isPlatformAdmin: boolean;
  /** Supabase Auth assurance level: aal2 once a TOTP factor is verified this session. */
  aal: "aal1" | "aal2";
}

/** Access failures. 401 = not signed in; 403 = wrong role, wrong owner, wrong hub or MFA needed. */
export class AccessDenied extends Error {
  readonly status: 401 | 403;
  readonly code: string;

  constructor(status: 401 | 403, code: string, message: string) {
    super(message);
    this.name = "AccessDenied";
    this.status = status;
    this.code = code;
  }
}

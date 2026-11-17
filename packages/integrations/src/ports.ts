/** Private media storage (seller photos, inspection photos, signatures). Server-side only. */
export interface StoragePort {
  /** A short-lived URL the browser can upload one file to, at exactly `path`. */
  createSignedUpload(bucket: string, path: string): Promise<{ signedUrl: string; path: string }>;
  /** True when an object exists at `path` (used to verify uploads, audit F5). */
  exists(bucket: string, path: string): Promise<boolean>;
  /** A short-lived download URL, or null when the object is missing. */
  signedDownloadUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string | null>;
}

export const PRIVATE_MEDIA_BUCKET = "private-media";

/** Seller payout transfers (UPI/IMPS/bank in production). Simulated in the capstone. */
export interface PayoutRail {
  readonly mode: "simulated" | "live";
  transfer(input: {
    payoutId: string;
    amount: number;
    accountRef: string | null;
    /** Settings.simulate_payout_failure — honoured only by the simulated rail. */
    simulateFailure: boolean;
  }): Promise<{ ok: true; reference: string } | { ok: false; reason: string }>;
}

/** Transactional email. Simulated in the capstone: messages are recorded, never delivered. */
export interface MailPort {
  readonly mode: "simulated" | "live";
  send(message: {
    to: string;
    subject: string;
    body: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }>;
}

/** Staff invitations: create (or find) the auth user and return a one-time sign-in link to copy. */
export interface AuthAdminPort {
  inviteLink(email: string, redirectTo: string): Promise<{ link: string; existingUser: boolean }>;
}

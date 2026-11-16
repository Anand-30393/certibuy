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

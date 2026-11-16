// Supabase Storage adapter for StoragePort. Uses the service-role key, so it must only ever run on
// the server; application policies decide who may upload or view a file before it is called.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { StoragePort } from "../ports";

let admin: SupabaseClient | null = null;

function adminClient(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase storage is not configured.");
  admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

export function createSupabaseStorage(): StoragePort {
  return {
    async createSignedUpload(bucket, path) {
      const { data, error } = await adminClient().storage.from(bucket).createSignedUploadUrl(path);
      if (error || !data) throw new Error("Could not prepare the upload.");
      return { signedUrl: data.signedUrl, path: data.path };
    },
    async exists(bucket, path) {
      const slash = path.lastIndexOf("/");
      const folder = path.slice(0, slash);
      const name = path.slice(slash + 1);
      const { data, error } = await adminClient()
        .storage.from(bucket)
        .list(folder, { search: name, limit: 10 });
      return !error && (data ?? []).some((o) => o.name === name);
    },
    async signedDownloadUrl(bucket, path, expiresInSeconds) {
      const { data, error } = await adminClient()
        .storage.from(bucket)
        .createSignedUrl(path, expiresInSeconds);
      return error || !data ? null : data.signedUrl;
    },
  };
}

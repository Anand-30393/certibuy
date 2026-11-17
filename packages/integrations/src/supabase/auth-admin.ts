// Supabase Auth admin adapter (service-role key, server only). Generates an invite link for a new
// staff member, or a magic sign-in link when the address already has an account. No email is sent:
// ops copies the link (zero-budget, docs/architecture.md §8.4).
import { createClient } from "@supabase/supabase-js";
import type { AuthAdminPort } from "../ports";

export function createSupabaseAuthAdmin(): AuthAdminPort {
  return {
    async inviteLink(email, redirectTo) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw new Error("Supabase admin is not configured.");
      const admin = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const invite = await admin.auth.admin.generateLink({
        type: "invite",
        email,
        options: { redirectTo },
      });
      if (!invite.error && invite.data.properties?.action_link) {
        return { link: invite.data.properties.action_link, existingUser: false };
      }
      const magic = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo },
      });
      if (magic.error || !magic.data.properties?.action_link)
        throw new Error("Could not create an invite link.");
      return { link: magic.data.properties.action_link, existingUser: true };
    },
  };
}

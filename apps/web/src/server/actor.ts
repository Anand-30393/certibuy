import { acceptPendingInvitation, type Actor } from "@certibuy/application";
import { getPrisma } from "@certibuy/db";
import { getAuthState } from "@certibuy/integrations/supabase";
import { cache } from "react";
import { getServerAuthClient } from "./supabase";

/**
 * The signed-in caller for this request: verified with Supabase, then the profile is re-read
 * from the database (roles are never taken from the browser or the token). Cached per request.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const auth = await getAuthState(await getServerAuthClient());
  if (!auth) return null;

  const db = getPrisma();
  // Role bootstrap fallback (X-02): the auth trigger normally creates the profile.
  let profile =
    (await db.profile.findUnique({ where: { id: auth.userId } })) ??
    (await db.profile.create({
      data: { id: auth.userId, email: auth.email, full_name: auth.fullName, app_role: "customer" },
    }));

  if (await acceptPendingInvitation(db, profile, new Date())) {
    profile = await db.profile.findUniqueOrThrow({ where: { id: profile.id } });
  }

  return {
    userId: profile.id,
    email: profile.email ?? auth.email,
    fullName: profile.full_name || auth.fullName,
    appRole: profile.app_role,
    activeMode: profile.active_mode,
    hubId: profile.hub_id,
    isPlatformAdmin: profile.is_platform_admin,
    aal: auth.aal,
  };
});

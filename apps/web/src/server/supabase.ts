import { createServerAuthClient, type AuthClient } from "@certibuy/integrations/supabase";
import { cookies } from "next/headers";

/** Supabase Auth client bound to this request's cookies. */
export async function getServerAuthClient(): Promise<AuthClient> {
  const store = await cookies();
  return createServerAuthClient({
    getAll: () => store.getAll(),
    setAll: (cookiesToSet) => {
      try {
        for (const { name, value, options } of cookiesToSet) store.set(name, value, options);
      } catch {
        // Server Components cannot set cookies; the proxy refreshes the session instead.
      }
    },
  });
}

// Supabase Auth adapters — the only place in the codebase that imports @supabase/*
// (docs/architecture.md §2). Frameworks pass their own cookie adapter in.
import { createBrowserClient, createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthClient = SupabaseClient;
export type { CookieMethodsServer };

function publicConfig(): { url: string; key: string } {
  // Literal references so Next.js inlines them into browser bundles.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase URL or publishable key is not configured.");
  return { url, key };
}

/** Server-side client bound to the request's cookies (session refresh happens through them). */
export function createServerAuthClient(cookies: CookieMethodsServer): AuthClient {
  const { url, key } = publicConfig();
  return createServerClient(url, key, { cookies });
}

/** Browser client for sign-in, sign-up, password reset and MFA enrolment. */
export function createBrowserAuthClient(): AuthClient {
  const { url, key } = publicConfig();
  return createBrowserClient(url, key);
}

export interface AuthState {
  userId: string;
  email: string | null;
  fullName: string | null;
  aal: "aal1" | "aal2";
}

/** Verified user (checked with Supabase, not just read from the cookie) and assurance level. */
export async function getAuthState(client: AuthClient): Promise<AuthState | null> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  const { data: level } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  const meta = data.user.user_metadata as { full_name?: unknown } | undefined;
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    fullName: typeof meta?.full_name === "string" ? meta.full_name : null,
    aal: level?.currentLevel === "aal2" ? "aal2" : "aal1",
  };
}

export { createSupabaseStorage } from "./storage";
export { createSupabaseAuthAdmin } from "./auth-admin";

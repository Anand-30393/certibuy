// Target for email confirmation, password-reset and staff-invite links.
import { NextResponse } from "next/server";
import { safeReturnTo } from "@/server/context";
import { getServerAuthClient } from "@/server/supabase";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeReturnTo(url.searchParams.get("next"));
  if (code) {
    const supabase = await getServerAuthClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL("/login?link=expired", url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}

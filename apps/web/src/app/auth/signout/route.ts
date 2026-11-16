import { NextResponse } from "next/server";
import { isSameOrigin } from "@/server/http";
import { getServerAuthClient } from "@/server/supabase";

export async function POST(request: Request) {
  if (isSameOrigin(request)) {
    const supabase = await getServerAuthClient();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}

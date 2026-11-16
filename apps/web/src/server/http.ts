import { AccessDenied } from "@certibuy/application";
import { DomainError } from "@certibuy/domain";
import { NextResponse } from "next/server";

const NO_STORE = { "cache-control": "private, no-store" };

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Errors use the documented shape: { error: "<sentence the UI can show>" }. */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof DomainError || e instanceof AccessDenied) {
    return json({ error: e.message, code: e.code }, e.status);
  }
  console.error(e);
  return json({ error: "Something went wrong on our side. Please try again." }, 500);
}

/** Commands must come from this site (CSRF guard alongside SameSite cookies). */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

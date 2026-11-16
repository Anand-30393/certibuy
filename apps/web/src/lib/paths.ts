/** Same-origin relative path only, so ?returnTo= cannot send people to another site. */
export function safeReturnTo(value: string | null | undefined, fallback = "/"): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

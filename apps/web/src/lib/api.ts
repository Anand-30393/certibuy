// Browser-side client for the command/view API. Commands are POSTs; the UI re-reads afterwards.
import type { ActiveMode } from "@certibuy/contracts";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function command<T>(name: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/v1/commands/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok)
    throw new ApiError(res.status, data.error ?? "Something went wrong. Please try again.");
  return data as T;
}

/** Returns the home path for the chosen side of the app. */
export async function setActiveMode(mode: ActiveMode): Promise<string> {
  const result = await command<{ ok: true; home: string }>("setActiveMode", { mode });
  return result.home;
}

/**
 * A business-rule failure. `status` follows the API error contract in docs/api.md.txt
 * (400 validation, 404 missing, 409 business conflict, 422 invalid slot/day) and
 * `message` is a sentence the UI can show.
 */
export class DomainError extends Error {
  readonly status: 400 | 404 | 409 | 422;
  readonly code: string;

  constructor(status: 400 | 404 | 409 | 422, code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.status = status;
    this.code = code;
  }
}

/** The engine never invents defaults: missing Settings is a hard stop (CLAUDE.md §2.1). */
export function requireSettings<T>(settings: T | null | undefined): T {
  if (settings == null) throw new DomainError(400, "settings_missing", "Settings are missing.");
  return settings;
}

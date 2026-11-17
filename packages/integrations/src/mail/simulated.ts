// Simulated mail: nothing leaves the system. The outbox row itself is the record shown in
// Ops → Mail log; a real provider (Resend / SES) would replace this adapter only.
import type { MailPort } from "../ports";

export function createSimulatedMail(): MailPort {
  return {
    mode: "simulated",
    async send({ to }) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to))
        return { ok: false, reason: "Invalid recipient address" };
      return { ok: true };
    },
  };
}

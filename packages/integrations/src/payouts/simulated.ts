// Simulated payout rail: no money moves. Fails only when Settings.simulate_payout_failure is on,
// with the documented reason, so the exception and retry paths can be demonstrated.
import type { PayoutRail } from "../ports";

export const SIMULATED_FAILURE_REASON = "Account name mismatch";

export function createSimulatedPayoutRail(): PayoutRail {
  return {
    mode: "simulated",
    async transfer({ payoutId, simulateFailure }) {
      if (simulateFailure) return { ok: false, reason: SIMULATED_FAILURE_REASON };
      return {
        ok: true,
        reference: `SIM-${payoutId.slice(-8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
      };
    },
  };
}

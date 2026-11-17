// One payout attempt through the payout rail and the domain payout state machine
// (docs/automations.md.txt §5). Used at handover and, later, by the daily payout run.
import { formatInr, attemptPayout, type PayoutStatus } from "@certibuy/domain";
import type { AppContext } from "../context";
import { loadSettings } from "../settings";
import { logActivity, notify } from "../support";
import { businessDate } from "@certibuy/domain";

const TYPE_LABEL: Record<string, string> = {
  instant_cash_full: "Instant Cash",
  advance: "advance",
  balance: "balance",
  mismatch_fee: "mismatch fee",
};

/**
 * Runs one transfer attempt for a pending/approved/failed payout. The rail is called outside any
 * transaction (in production it is a network call); the result is then written atomically:
 * status writes (approved → paid on success), a payout_attempts row, and on reaching the attempt
 * limit one payment_hold exception plus seller and ops notifications.
 */
export async function runPayoutAttempt(
  ctx: Pick<AppContext, "db" | "payouts" | "now" | "env" | "actor">,
  payoutId: string,
): Promise<{ status: PayoutStatus; attempts: number }> {
  const s = await loadSettings(ctx.db);
  const payout = await ctx.db.payout.findUniqueOrThrow({
    where: { id: payoutId },
    include: { seller: { select: { payout_account: true } } },
  });
  const transfer = await ctx.payouts.transfer({
    payoutId: payout.id,
    amount: payout.amount,
    accountRef: payout.seller.payout_account,
    simulateFailure: s.simulate_payout_failure,
  });
  const result = attemptPayout(
    { status: payout.status as PayoutStatus, attempts: payout.attempts },
    transfer.ok ? { ok: true } : { ok: false, reason: transfer.reason },
    s,
  );
  const day = businessDate(ctx.now, s);

  await ctx.db.$transaction(async (tx) => {
    // Two writes on success mirror real rails (authorisation, then settlement).
    for (const status of result.writes) {
      await tx.payout.update({
        where: { id: payout.id },
        data: {
          status,
          attempts: result.attempts,
          failure_reason: result.failureReason || null,
          ...(status === "paid" ? { paid_at: ctx.now } : {}),
        },
      });
    }
    await tx.payoutAttempt.create({
      data: {
        payout_id: payout.id,
        attempt: result.attempts,
        status: result.status,
        reference: transfer.ok ? transfer.reference : null,
        failure_reason: transfer.ok ? null : transfer.reason,
      },
    });
    const label = TYPE_LABEL[payout.type] ?? payout.type;
    if (result.status === "paid") {
      await notify(
        tx,
        [
          {
            userId: payout.seller_id,
            event: payout.type === "balance" ? "balance_paid" : "payout_paid",
            title: `Your ${label} of ${formatInr(payout.amount)} is paid`,
            body: "The money is on its way to your payout account (simulated in this demo).",
            link: "/seller/payouts",
          },
        ],
        ctx.env.appPublicUrl,
      );
    }
    if (result.openException) {
      await tx.exceptionCase.create({
        data: {
          type: "payment_hold",
          title: `Payout on hold: ${label} ${formatInr(payout.amount)}`,
          detail: `${result.attempts} attempts failed. Last reason: ${result.failureReason}.`,
          related_entity: "payout",
          related_id: payout.id,
        },
      });
      const ops = await tx.profile.findMany({
        where: { OR: [{ app_role: "ops" }, { is_platform_admin: true }] },
        select: { id: true },
      });
      await notify(
        tx,
        [
          {
            userId: payout.seller_id,
            event: "payout_failed",
            title: "We couldn't pay you yet",
            body: `Your ${label} of ${formatInr(payout.amount)} is on hold. Check your payout account in your profile; we'll retry.`,
            link: "/seller/payouts",
          },
          ...ops.map((o) => ({
            userId: o.id,
            event: "payout_hold",
            title: "A payout is on hold",
            body: `${label} ${formatInr(payout.amount)} failed ${result.attempts} times.`,
            link: "/ops",
          })),
        ],
        ctx.env.appPublicUrl,
      );
    }
    if (payout.submission_id) {
      await logActivity(tx, {
        actor: null,
        text:
          result.status === "paid"
            ? `Paid ${label} ${formatInr(payout.amount)}.`
            : `Payout attempt ${result.attempts} for the ${label} failed: ${result.failureReason}.`,
        entity: "submission",
        entityId: payout.submission_id,
        businessDate: day,
      });
    }
  });
  return { status: result.status, attempts: result.attempts };
}

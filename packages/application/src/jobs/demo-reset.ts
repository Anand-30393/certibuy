// O-11 Ops → Demo → Reset demo data. Removes deals, devices, orders and their ledger rows that
// belong only to seeded demo/test accounts (planDemoReset); real customers' data is never touched.
// Platform admin, demo mode, DEMO_TOOLS_ENABLED and a typed confirmation are all required.
import { DomainError, isDemoEmail, planDemoReset } from "@certibuy/domain";
import { z } from "zod";
import { AccessDenied } from "../actor";
import { defineHandler } from "../registry";
import { loadSettings } from "../settings";
import { logActivity } from "../support";
import { recalcLiquidity } from "./handlers";
import { businessDate } from "@certibuy/domain";

export const RESET_CONFIRMATION = "RESET DEMO DATA";

export const ResetDemoDataOutput = z.object({
  ok: z.literal(true),
  removed: z.object({
    deals: z.number(),
    devices: z.number(),
    orders: z.number(),
    payouts: z.number(),
    files: z.number(),
  }),
  kept: z.object({ deals: z.number(), orders: z.number() }),
});

export const resetDemoData = defineHandler({
  auth: ["ops"],
  input: z
    .object({
      confirm: z.literal(RESET_CONFIRMATION, {
        error: `Type ${RESET_CONFIRMATION} to confirm.`,
      }),
    })
    .strict(),
  output: ResetDemoDataOutput,
  async run(ctx) {
    if (!ctx.actor.isPlatformAdmin) {
      throw new AccessDenied(403, "admin_only", "Only a platform admin can reset demo data.");
    }
    const s0 = await loadSettings(ctx.db);
    if (!s0.demo_mode || !ctx.env.demoToolsEnabled) {
      throw new DomainError(409, "demo_off", "Demo tools are turned off in this environment.");
    }

    const profiles = await ctx.db.profile.findMany({ select: { id: true, email: true } });
    const demoIds = new Set(profiles.filter((p) => isDemoEmail(p.email)).map((p) => p.id));
    const [subs, devices, orders] = await Promise.all([
      ctx.db.submission.findMany({ select: { id: true, seller_id: true } }),
      ctx.db.device.findMany({ select: { id: true, submission_id: true } }),
      ctx.db.order.findMany({
        select: { id: true, buyer_id: true, device_id: true, replacement_device_id: true },
      }),
    ]);
    const plan = planDemoReset(
      {
        submissions: subs.map((x) => ({ id: x.id, sellerId: x.seller_id })),
        devices: devices.map((x) => ({ id: x.id, submissionId: x.submission_id })),
        orders: orders.map((x) => ({
          id: x.id,
          buyerId: x.buyer_id,
          deviceId: x.device_id,
          replacementDeviceId: x.replacement_device_id,
        })),
      },
      (id) => demoIds.has(id),
    );
    const subIds = plan.submissionIds;
    const deviceIds = plan.deviceIds;
    const orderIds = plan.orderIds;
    const demoUsers = [...demoIds];

    const result = await ctx.db.$transaction(
      async (tx) => {
        // Lets the ledger triggers accept these deletes, for this transaction only.
        await tx.$executeRaw`SELECT set_config('app.demo_reset', 'on', true)`;
        const returns = await tx.returnRequest.findMany({
          where: { order_id: { in: orderIds } },
          select: { id: true },
        });
        const returnIds = returns.map((r) => r.id);
        const payouts = await tx.payout.findMany({
          where: { OR: [{ submission_id: { in: subIds } }, { device_id: { in: deviceIds } }] },
          select: { id: true },
        });
        const payoutIds = payouts.map((p) => p.id);
        const files = await tx.fileObject.findMany({
          where: { related_id: { in: [...subIds, ...returnIds, ...deviceIds] } },
          select: { id: true, bucket: true, key: true },
        });
        const allIds = [...subIds, ...deviceIds, ...orderIds, ...returnIds, ...payoutIds];

        await tx.escrowTransaction.deleteMany({ where: { order_id: { in: orderIds } } });
        await tx.inspectionReport.deleteMany({
          where: {
            OR: [{ submission_id: { in: subIds } }, { return_request_id: { in: returnIds } }],
          },
        });
        await tx.returnRequest.deleteMany({ where: { id: { in: returnIds } } });
        await tx.shipment.deleteMany({ where: { order_id: { in: orderIds } } });
        await tx.paymentIntent.deleteMany({ where: { order_id: { in: orderIds } } });
        await tx.order.deleteMany({ where: { id: { in: orderIds } } });
        await tx.payoutAttempt.deleteMany({ where: { payout_id: { in: payoutIds } } });
        await tx.payout.deleteMany({ where: { id: { in: payoutIds } } });
        await tx.listing.deleteMany({ where: { device_id: { in: deviceIds } } });
        await tx.device.deleteMany({ where: { id: { in: deviceIds } } });
        await tx.offer.deleteMany({ where: { submission_id: { in: subIds } } });
        await tx.gradeAssessment.deleteMany({ where: { submission_id: { in: subIds } } });
        await tx.booking.deleteMany({ where: { submission_id: { in: subIds } } });
        await tx.submission.deleteMany({ where: { id: { in: subIds } } });
        await tx.fileObject.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });
        await tx.exceptionCase.deleteMany({ where: { related_id: { in: allIds } } });
        await tx.activityLog.deleteMany({ where: { entity_id: { in: allIds } } });
        // Demo accounts' own inbox, care requests and queued mail; profiles go back to defaults.
        await tx.notification.deleteMany({ where: { user_id: { in: demoUsers } } });
        await tx.outbox.deleteMany({ where: { user_id: { in: demoUsers } } });
        await tx.supportRequest.deleteMany({ where: { customer_id: { in: demoUsers } } });
        await tx.profile.updateMany({
          where: { id: { in: demoUsers }, app_role: "customer" },
          data: { trust_score: 100, return_count: 0, account_flagged: false, active_mode: null },
        });
        await tx.settings.update({
          where: { id: 1 },
          data: { sim_day_offset: 0, simulate_payout_failure: false },
        });
        const s = await loadSettings(tx);
        await logActivity(tx, {
          actor: ctx.actor,
          text: `Demo data reset: removed ${subIds.length} deals, ${deviceIds.length} devices and ${orderIds.length} orders of demo accounts; kept ${plan.protectedSubmissions} deals and ${plan.protectedOrders} orders linked to real customers.`,
          entity: "settings",
          entityId: "1",
          businessDate: businessDate(ctx.now, s),
        });
        return { payouts: payoutIds.length, files };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );

    // Stored files go after the commit, best-effort: a leftover object is harmless.
    let removedFiles = 0;
    const byBucket = new Map<string, string[]>();
    for (const f of result.files)
      byBucket.set(f.bucket, [...(byBucket.get(f.bucket) ?? []), f.key]);
    for (const [bucket, keys] of byBucket) {
      removedFiles += await ctx.storage.remove(bucket, keys).catch(() => 0);
    }
    // Liquidity scores were measured from sales that are now gone: recompute from what is left
    // (models fall back to cold-start scores). A failure here never undoes the reset.
    await recalcLiquidity(ctx).catch(() => undefined);

    return {
      ok: true as const,
      removed: {
        deals: subIds.length,
        devices: deviceIds.length,
        orders: orderIds.length,
        payouts: result.payouts,
        files: removedFiles,
      },
      kept: { deals: plan.protectedSubmissions, orders: plan.protectedOrders },
    };
  },
});

// Time-based behaviour (docs/automations.md.txt): the daily job, liquidity recalculation, outbox
// delivery, checkout-hold expiry, demo clock and payout retry — all manual commands (ADR 0003).
// Every step acts only on records whose business dates have passed and checks for an existing
// record before writing money or a reminder, so a rerun (or a late catch-up run) is safe.
import {
  AdvanceDemoClockInput,
  AdvanceDemoClockOutput,
  EmptyInput,
  JobResultOutput,
  JobsBoardView,
  MailLogView,
  MarkNotificationsReadInput,
  NotificationsInput,
  NotificationsView,
  RetryPayoutInput,
  RunDailyJobsInput,
  RunDailyJobsOutput,
  SetDemoSettingsInput,
  type DailyCountsT,
} from "@certibuy/contracts";
import { fromIsoDate, toIsoDate } from "@certibuy/db";
import {
  addDays,
  businessDate,
  cancelOrder as domainCancelOrder,
  daysListed,
  diffDays,
  DomainError,
  escrowReleasable,
  formatInr,
  inLaunchWindow,
  isNoShow,
  istDate,
  ladderAdvances,
  ladderPosition,
  offerExpired,
  promoteBalance,
  reminderDue,
  scoreModel,
  type Settings,
} from "@certibuy/domain";
import { z } from "zod";
import type { Actor } from "../actor";
import type { AppContext } from "../context";
import { releaseReservation } from "../listing";
import { resetDemoData } from "./demo-reset";
import { runPayoutAttempt } from "../money/payouts";
import { defineHandler, type AnyHandler } from "../registry";
import { loadSettings } from "../settings";
import { logActivity, notify, type NotificationRow, type Tx } from "../support";

export type JobContext = Omit<AppContext, "actor"> & { actor: Actor | null };

const deviceName = (m: { brand: string; model: string; storage: string }) =>
  `${m.brand} ${m.model} ${m.storage}`;
const orderNo = (id: string) => `CB-${id.slice(-6).toUpperCase()}`;

async function opsUserIds(tx: Tx): Promise<string[]> {
  const ops = await tx.profile.findMany({
    where: { OR: [{ app_role: "ops" }, { is_platform_admin: true }] },
    select: { id: true },
  });
  return ops.map((o) => o.id);
}

/** A reminder or alert sent at most once per (user, event, link): the dedupe key is unique. */
async function notifyOnce(
  tx: Tx,
  row: NotificationRow & { dedupeKey: string },
  appPublicUrl: string,
): Promise<boolean> {
  if (await tx.notification.findUnique({ where: { dedupe_key: row.dedupeKey } })) return false;
  await notify(tx, [row], appPublicUrl);
  return true;
}

async function startRun(ctx: JobContext, job: string, day: string) {
  const key = { job_business_date: { job, business_date: fromIsoDate(day) } };
  const existing = await ctx.db.jobRun.findUnique({ where: key });
  if (
    existing?.status === "running" &&
    ctx.now.getTime() - existing.started_at.getTime() < 10 * 60_000
  ) {
    throw new DomainError(
      409,
      "job_running",
      "This job is already running. Wait a minute and refresh.",
    );
  }
  return ctx.db.jobRun.upsert({
    where: key,
    create: {
      job,
      business_date: fromIsoDate(day),
      actor_id: ctx.actor?.userId ?? null,
      started_at: ctx.now,
    },
    update: {
      status: "running",
      started_at: ctx.now,
      finished_at: null,
      actor_id: ctx.actor?.userId ?? null,
    },
  });
}

async function finishRun(
  ctx: JobContext,
  id: string,
  status: "done" | "failed",
  counts: Record<string, number>,
) {
  await ctx.db.jobRun.update({ where: { id }, data: { status, counts, finished_at: new Date() } });
}

// --------------------------------------------------------------------------- outbox

/** Deliver queued email through the mail adapter (simulated). Failures are recorded, never thrown. */
export async function processOutbox(ctx: Pick<AppContext, "db" | "mail" | "now">): Promise<number> {
  const pending = await ctx.db.outbox.findMany({
    where: { status: "pending" },
    orderBy: { created_date: "asc" },
    take: 200,
  });
  let sent = 0;
  for (const m of pending) {
    const r = await ctx.mail
      .send({ to: m.to_email, subject: m.subject, body: m.body })
      .catch((e: unknown) => ({
        ok: false as const,
        reason: e instanceof Error ? e.message : "Mail error",
      }));
    // Conditional update: a concurrent run can't send the same message twice.
    const updated = await ctx.db.outbox.updateMany({
      where: { id: m.id, status: "pending" },
      data: r.ok
        ? { status: "sent", sent_at: ctx.now }
        : { status: "failed", failure_reason: r.reason },
    });
    if (r.ok && updated.count) sent++;
  }
  return sent;
}

// --------------------------------------------------------------------------- daily job

export async function runDailyJob(ctx: JobContext, override?: string) {
  const s = await loadSettings(ctx.db);
  const day = override ?? businessDate(ctx.now, s);
  const run = await startRun(ctx, "daily", day);
  const counts: DailyCountsT = {
    stepped: 0,
    reviewed: 0,
    reservedUpdated: 0,
    balances: 0,
    payoutsPaid: 0,
    payoutsFailed: 0,
    settled: 0,
    expiredOffers: 0,
    noShows: 0,
    reminders: 0,
    emailsSent: 0,
  };
  try {
    await stepLadder(ctx, s, day, counts);
    await stepBalances(ctx, s, day, counts);
    await stepPayouts(ctx, counts);
    await stepEscrow(ctx, s, day, counts);
    await stepOffers(ctx, s, day, counts);
    await stepNoShows(ctx, day, counts);
    await stepReminders(ctx, s, day, counts);
    counts.emailsSent = await processOutbox(ctx);
    await finishRun(ctx, run.id, "done", counts);
  } catch (e) {
    // Earlier steps are already committed; a rerun completes the rest (all steps are idempotent).
    await finishRun(ctx, run.id, "failed", counts);
    throw e;
  }
  return { businessDate: day, counts };
}

/** Step 1 — price ladder (steps down only), held days for reserved listings, day-45 review. */
async function stepLadder(ctx: JobContext, s: Settings, day: string, counts: DailyCountsT) {
  const listings = await ctx.db.listing.findMany({
    where: { status: { in: ["active", "reserved"] } },
    include: {
      device: { include: { device_model: true } },
      orders: {
        where: { status: { in: ["pending", "paid"] } },
        orderBy: { created_date: "desc" },
        take: 1,
      },
    },
  });
  const ops = await opsUserIds(ctx.db);
  for (const l of listings) {
    // Reserved days are added when the reservation ends (listing.ts), so a reserved listing
    // never ages here and the business clock offset at payment time can't skew the count.
    if (l.status === "reserved") continue;
    const days = daysListed(toIsoDate(l.listed_at), day, l.reserved_days);
    const pos = ladderPosition(
      {
        basePrice: l.base_price,
        floorPrice: l.floor_price,
        daysListed: days,
        overridePrice: l.override_price,
      },
      s,
    );
    const name = deviceName(l.device.device_model);
    if (pos.review) {
      await ctx.db.$transaction(async (tx) => {
        const moved = await tx.listing.updateMany({
          where: { id: l.id, status: "active" },
          data: { status: "review", ladder_step: Math.max(l.ladder_step, pos.ladderStep) },
        });
        if (!moved.count) return;
        await tx.device.update({ where: { id: l.device_id }, data: { status: "day45_review" } });
        for (const userId of ops) {
          await notifyOnce(
            tx,
            {
              userId,
              event: "day45_review",
              title: `Day ${s.review_day} review: ${name}`,
              body: `Listed ${days} days and still unsold. Liquidate it to B2B at ${formatInr(l.floor_price)}, or reprice it.`,
              link: "/ops/inventory",
              dedupeKey: `${userId}|day45_review|${l.id}`,
            },
            ctx.env.appPublicUrl,
          );
        }
        await logActivity(tx, {
          actor: null,
          text: `${name} reached the day-${s.review_day} review.`,
          entity: "listing",
          entityId: l.id,
          businessDate: day,
        });
        counts.reviewed++;
      });
      continue;
    }
    if (!ladderAdvances(l.ladder_step, pos.ladderStep)) continue;
    await ctx.db.$transaction(async (tx) => {
      const moved = await tx.listing.updateMany({
        where: { id: l.id, status: "active", ladder_step: l.ladder_step },
        // An override holds the price; the step is still recorded for reporting.
        data: {
          ladder_step: pos.ladderStep,
          ...(pos.priceMovedByLadder ? { current_price: pos.ladderPrice } : {}),
        },
      });
      if (!moved.count) return;
      const pct = pos.ladderStep === 2 ? s.step2_pct : s.step1_pct;
      await logActivity(tx, {
        actor: null,
        text: pos.priceMovedByLadder
          ? `${name} stepped down ${pct}% to ${formatInr(pos.ladderPrice)} (day ${days} listed).`
          : `${name} reached ladder step ${pos.ladderStep}; the ops override price holds.`,
        entity: "listing",
        entityId: l.id,
        businessDate: day,
      });
      counts.stepped++;
    });
  }
}

/** Step 2 — Sell For More balance becomes payable on custody day + balance_day if still due. */
async function stepBalances(ctx: JobContext, s: Settings, day: string, counts: DailyCountsT) {
  const due = await ctx.db.payout.findMany({
    where: { type: "balance", status: "due" },
    include: { device: true },
  });
  for (const p of due) {
    if (!p.device) continue;
    const r = promoteBalance(
      { status: "due", custodyAt: toIsoDate(p.device.custody_at), today: day, buyerPaid: false },
      s,
    );
    if (r.status !== "pending") continue;
    await ctx.db.$transaction(async (tx) => {
      const moved = await tx.payout.updateMany({
        where: { id: p.id, status: "due" },
        data: { status: "pending", trigger: "day_21_unsold" },
      });
      if (!moved.count) return;
      await tx.device.update({
        where: { id: p.device_id as string },
        data: { balance_paid: true },
      });
      if (p.submission_id) {
        await logActivity(tx, {
          actor: null,
          text: `Day ${s.balance_day}: balance of ${formatInr(p.amount)} is now payable.`,
          entity: "submission",
          entityId: p.submission_id,
          businessDate: day,
        });
      }
      counts.balances++;
    });
  }
}

/** Step 3 — one attempt for every payable payout through the (simulated) rail. */
async function stepPayouts(ctx: JobContext, counts: DailyCountsT) {
  const payable = await ctx.db.payout.findMany({
    where: { status: { in: ["pending", "approved"] }, type: { not: "mismatch_fee" } },
    orderBy: { created_date: "asc" },
    select: { id: true },
  });
  for (const p of payable) {
    try {
      const r = await runPayoutAttempt(ctx, p.id);
      if (r.status === "paid") counts.payoutsPaid++;
      else if (r.status === "failed") counts.payoutsFailed++;
    } catch (e) {
      // Another run is already paying this one; anything else counts as a failure.
      if (e instanceof DomainError && e.code === "payout_in_progress") continue;
      counts.payoutsFailed++; // one bad payout never stops the run
    }
  }
}

/** Step 4 — release escrow once the return window has closed with no open return. */
async function stepEscrow(ctx: JobContext, s: Settings, day: string, counts: DailyCountsT) {
  const orders = await ctx.db.order.findMany({
    where: { status: "delivered", escrow_status: "hold" },
    include: { return_requests: true, device: { include: { device_model: true } } },
  });
  for (const o of orders) {
    const releasable = escrowReleasable({
      orderStatus: o.status,
      escrowStatus: o.escrow_status,
      closesAt: o.return_window_closes_at ? toIsoDate(o.return_window_closes_at) : null,
      today: day,
      hasOpenReturn: o.return_requests.some((r) => r.status !== "resolved"),
    });
    if (!releasable) continue;
    await ctx.db.$transaction(async (tx) => {
      const moved = await tx.order.updateMany({
        where: { id: o.id, status: "delivered", escrow_status: "hold" },
        data: { status: "settled", escrow_status: "released", settled_at: ctx.now },
      });
      if (!moved.count) return;
      // The partial unique index also guarantees a single release per order.
      await tx.escrowTransaction.create({
        data: {
          order_id: o.id,
          buyer_id: o.buyer_id,
          type: "release",
          amount: o.total,
          note: "Return window closed",
        },
      });
      await tx.device.update({
        where: { id: o.replacement_device_id ?? o.device_id },
        data: { status: "settled" },
      });
      await notify(
        tx,
        [
          {
            userId: o.buyer_id,
            event: "escrow_released",
            title: `Order ${orderNo(o.id)} complete`,
            body: "Your return window has closed and the order is complete. Enjoy your device.",
            link: `/shop/orders/${o.id}`,
          },
        ],
        ctx.env.appPublicUrl,
      );
      await logActivity(tx, {
        actor: null,
        text: `Escrow released for ${orderNo(o.id)} (${formatInr(o.total)}).`,
        entity: "order",
        entityId: o.id,
        businessDate: day,
      });
      counts.settled++;
    });
  }
}

/** Step 5 — expire offers past their date; close deals whose live offer expired. */
async function stepOffers(ctx: JobContext, s: Settings, day: string, counts: DailyCountsT) {
  const offers = await ctx.db.offer.findMany({
    where: { status: "active", expires_at: { lt: fromIsoDate(day) } },
    include: { submission: { include: { device_model: true } } },
  });
  for (const o of offers) {
    if (!offerExpired(toIsoDate(o.expires_at), day)) continue;
    await ctx.db.$transaction(async (tx) => {
      const moved = await tx.offer.updateMany({
        where: { id: o.id, status: "active" },
        data: { status: "expired" },
      });
      if (!moved.count) return;
      counts.expiredOffers++;
      const sub = o.submission;
      if (sub.current_offer_id === o.id && ["draft", "graded"].includes(sub.status)) {
        await tx.submission.update({ where: { id: sub.id }, data: { status: "abandoned" } });
        await notify(
          tx,
          [
            {
              userId: sub.seller_id,
              event: "deal_abandoned",
              title: "Your offer expired",
              body: `The offer for your ${deviceName(sub.device_model)} expired. Start a new valuation for a fresh price.`,
              link: `/seller/deals/${sub.id}`,
            },
          ],
          ctx.env.appPublicUrl,
        );
        await logActivity(tx, {
          actor: null,
          text: "Offer expired; deal closed.",
          entity: "submission",
          entityId: sub.id,
          businessDate: day,
        });
      }
    });
  }

  // Accepted offers not handed over by their deadline (acceptance + offer_expiry_days) close the
  // deal: the offer expires, live bookings are cancelled and the seller is told.
  const lapsed = await ctx.db.offer.findMany({
    where: {
      status: "accepted",
      expires_at: { lt: fromIsoDate(day) },
      submission: { status: { in: PRE_HANDOVER }, device: { is: null } },
    },
    include: { submission: { include: { device_model: true } } },
  });
  for (const o of lapsed) {
    if (!offerExpired(toIsoDate(o.expires_at), day)) continue;
    await ctx.db.$transaction(async (tx) => {
      const moved = await tx.offer.updateMany({
        where: { id: o.id, status: "accepted" },
        data: { status: "expired" },
      });
      if (!moved.count) return;
      const closed = await tx.submission.updateMany({
        where: { id: o.submission_id, status: { in: PRE_HANDOVER } },
        data: { status: "abandoned" },
      });
      if (!closed.count) return;
      await tx.booking.updateMany({
        where: { submission_id: o.submission_id, status: "booked" },
        data: { status: "cancelled" },
      });
      counts.expiredOffers++;
      const sub = o.submission;
      await notify(
        tx,
        [
          {
            userId: sub.seller_id,
            event: "deal_abandoned",
            title: "Your accepted offer expired",
            body: `Your ${deviceName(sub.device_model)} wasn't handed over by ${toIsoDate(o.expires_at)}. Start a new valuation for a fresh price.`,
            link: `/seller/deals/${sub.id}`,
          },
        ],
        ctx.env.appPublicUrl,
      );
      await logActivity(tx, {
        actor: null,
        text: `Accepted offer expired on ${toIsoDate(o.expires_at)} without handover; deal closed.`,
        entity: "submission",
        entityId: sub.id,
        businessDate: day,
      });
    });
  }
  void s;
}

const PRE_HANDOVER: ("offer_accepted" | "scheduled" | "inspected" | "accepted")[] = [
  "offer_accepted",
  "scheduled",
  "inspected",
  "accepted",
];

/** Step 6 — missed hub bookings become no-shows; the seller can book again. */
async function stepNoShows(ctx: JobContext, day: string, counts: DailyCountsT) {
  const bookings = await ctx.db.booking.findMany({
    where: { status: "booked", date: { lt: fromIsoDate(day) } },
  });
  for (const b of bookings) {
    if (!isNoShow({ status: b.status, date: toIsoDate(b.date) }, day)) continue;
    await ctx.db.$transaction(async (tx) => {
      const moved = await tx.booking.updateMany({
        where: { id: b.id, status: "booked" },
        data: { status: "no_show" },
      });
      if (!moved.count) return;
      await tx.submission.updateMany({
        where: { id: b.submission_id, status: "scheduled" },
        data: { status: "offer_accepted" },
      });
      await logActivity(tx, {
        actor: null,
        text: `Missed hub visit on ${toIsoDate(b.date)}; book a new slot to continue.`,
        entity: "submission",
        entityId: b.submission_id,
        businessDate: day,
      });
      counts.noShows++;
    });
  }
}

/** Step 7 — offer-expiring and return-window-closing reminders, each sent once. */
async function stepReminders(ctx: JobContext, s: Settings, day: string, counts: DailyCountsT) {
  const offers = await ctx.db.offer.findMany({
    where: { status: "active", submission: { status: "graded" } },
    include: { submission: { include: { device_model: true } } },
  });
  for (const o of offers) {
    const expires = toIsoDate(o.expires_at);
    if (!reminderDue(expires, day, s.alert_window_days)) continue;
    const link = `/seller/sell/${o.submission_id}/offer`;
    const sent = await ctx.db.$transaction((tx) =>
      notifyOnce(
        tx,
        {
          userId: o.seller_id,
          event: "offer_expiring",
          title: "Your offer expires soon",
          body: `Your offer for the ${deviceName(o.submission.device_model)} is valid until ${expires}.`,
          link,
          dedupeKey: `${o.seller_id}|offer_expiring|${link}`,
        },
        ctx.env.appPublicUrl,
      ),
    );
    if (sent) counts.reminders++;
  }
  const orders = await ctx.db.order.findMany({
    where: { status: "delivered", escrow_status: "hold" },
  });
  for (const o of orders) {
    if (!o.return_window_closes_at) continue;
    const closes = toIsoDate(o.return_window_closes_at);
    if (!reminderDue(closes, day, s.alert_window_days)) continue;
    const link = `/shop/orders/${o.id}`;
    const sent = await ctx.db.$transaction((tx) =>
      notifyOnce(
        tx,
        {
          userId: o.buyer_id,
          event: "return_window_closing",
          title: "Your return window closes soon",
          body: `You can raise a return on ${orderNo(o.id)} until ${closes}.`,
          link,
          dedupeKey: `${o.buyer_id}|return_window_closing|${link}|${closes}`,
        },
        ctx.env.appPublicUrl,
      ),
    );
    if (sent) counts.reminders++;
  }
}

// --------------------------------------------------------------------------- liquidity

export async function recalcLiquidity(ctx: JobContext) {
  const s = await loadSettings(ctx.db);
  const day = businessDate(ctx.now, s);
  const run = await startRun(ctx, "liquidity", day);
  const since = fromIsoDate(addDays(day, -56));
  const models = await ctx.db.deviceModel.findMany({ where: { active: true } });
  const ops = await opsUserIds(ctx.db);
  const counts = { models: 0, measured: 0, coldStart: 0, crossings: 0 };
  for (const m of models) {
    const sold = await ctx.db.order.findMany({
      where: {
        status: { in: ["delivered", "settled"] },
        paid_at: { gte: since },
        device: { device_model_id: m.id },
      },
      include: { listing: true },
    });
    const activeListings = await ctx.db.listing.count({
      where: { status: "active", device: { device_model_id: m.id } },
    });
    const reviews = await ctx.db.listing.count({
      where: { status: { in: ["review", "liquidated"] }, device: { device_model_id: m.id } },
    });
    const result = scoreModel(
      {
        tier: m.liquidity_tier,
        salesDaysToSell: sold.map((o) =>
          Math.max(
            0,
            diffDays(toIsoDate(o.listing.listed_at), istDate(o.paid_at ?? o.created_date)),
          ),
        ),
        achievedPriceRatios: sold.map((o) => o.device_price / m.market_price_a),
        recentSales: sold.length,
        activeListings,
        launchWindow: inLaunchWindow(
          m.successor_launch_date ? toIsoDate(m.successor_launch_date) : null,
          day,
          s,
        ),
        day45Returns: reviews,
      },
      s,
    );
    const previous = await ctx.db.liquidityScore.findFirst({
      where: { device_model_id: m.id, is_current: true },
    });
    await ctx.db.$transaction(async (tx) => {
      await tx.liquidityScore.updateMany({
        where: { device_model_id: m.id, is_current: true },
        data: { is_current: false },
      });
      await tx.liquidityScore.create({
        data: {
          device_model_id: m.id,
          score: result.score,
          days_to_sell: result.daysToSell,
          volatility: result.volatility,
          launch_window: inLaunchWindow(
            m.successor_launch_date ? toIsoDate(m.successor_launch_date) : null,
            day,
            s,
          )
            ? 1
            : 0,
          source: result.source,
          calculated_at: ctx.now,
          is_current: true,
        },
      });
      const was = previous?.score;
      const crossedDown =
        was !== undefined && was >= s.liquidity_threshold && result.score < s.liquidity_threshold;
      const crossedUp =
        was !== undefined && was < s.liquidity_threshold && result.score >= s.liquidity_threshold;
      if (crossedDown || crossedUp) {
        counts.crossings++;
        const stock = await tx.device.count({
          where: {
            device_model_id: m.id,
            status: { in: ["listed", "day45_review", "in_refurbishment"] },
          },
        });
        for (const userId of ops) {
          await notify(
            tx,
            [
              {
                userId,
                event:
                  crossedDown && stock > 0 && !m.ic_paused
                    ? "instant_cash_paused"
                    : "liquidity_changed",
                title: `${m.brand} ${m.model}: liquidity ${crossedDown ? "below" : "back above"} ${s.liquidity_threshold}`,
                body:
                  crossedDown && stock > 0 && !m.ic_paused
                    ? `Score ${result.score} with ${stock} in stock. Consider pausing Instant Cash.`
                    : `Score is now ${result.score}.`,
                link: "/ops",
              },
            ],
            ctx.env.appPublicUrl,
          );
        }
      }
    });
    counts.models++;
    if (result.source === "measured") counts.measured++;
    else counts.coldStart++;
  }
  await finishRun(ctx, run.id, "done", counts);
  return counts;
}

// --------------------------------------------------------------------------- holds, demo, payouts

export async function expireCheckoutHolds(ctx: JobContext) {
  const s = await loadSettings(ctx.db);
  const day = businessDate(ctx.now, s);
  const expired = await ctx.db.order.findMany({
    where: { status: "pending", hold_expires_at: { lt: ctx.now } },
  });
  let cancelled = 0;
  for (const o of expired) {
    await ctx.db.$transaction(async (tx) => {
      const moved = await tx.order.updateMany({
        where: { id: o.id, status: "pending" },
        data: {
          status: "cancelled",
          cancelled_at: ctx.now,
          cancel_reason: "Payment not completed in time",
        },
      });
      if (!moved.count) return;
      domainCancelOrder({ orderStatus: "pending", total: o.total }, s);
      await releaseReservation(tx, o.listing_id, day);
      await tx.device.update({ where: { id: o.device_id }, data: { status: "listed" } });
      await notify(
        tx,
        [
          {
            userId: o.buyer_id,
            event: "order_cancelled",
            title: `Order ${orderNo(o.id)} cancelled`,
            body: "The payment wasn't completed in time, so the device was released. No payment was taken.",
            link: `/shop/orders/${o.id}`,
          },
        ],
        ctx.env.appPublicUrl,
      );
      await logActivity(tx, {
        actor: null,
        text: `Checkout hold expired for ${orderNo(o.id)}.`,
        entity: "order",
        entityId: o.id,
        businessDate: day,
      });
      cancelled++;
    });
  }
  return { cancelled };
}

function assertDemo(ctx: JobContext, s: Settings) {
  if (!s.demo_mode || !ctx.env.demoToolsEnabled) {
    throw new DomainError(409, "demo_off", "Demo tools are turned off in this environment.");
  }
}

const OPS = ["ops"] as const;
const ok = (counts: Record<string, number>) => ({ ok: true as const, counts });

export const runDailyJobs = defineHandler({
  auth: OPS,
  input: RunDailyJobsInput,
  output: RunDailyJobsOutput,
  async run(ctx, input) {
    // A catch-up run for a missed day is fine; a future date would age deals early (release
    // escrow inside an open return window), so the demo clock is the only way forward.
    if (input.businessDate) {
      const s = await loadSettings(ctx.db);
      if (input.businessDate > businessDate(ctx.now, s)) {
        throw new DomainError(
          400,
          "future_date",
          "The daily job can't run for a future date. Use the demo clock instead.",
        );
      }
    }
    const r = await runDailyJob(ctx, input.businessDate);
    return { ok: true as const, done: true, ...r };
  },
});

/** O-11: move the business clock forward N days, then run the daily job for the new date. */
export const advanceDemoClock = defineHandler({
  auth: OPS,
  input: AdvanceDemoClockInput,
  output: AdvanceDemoClockOutput,
  async run(ctx, input) {
    const s = await loadSettings(ctx.db);
    assertDemo(ctx, s);
    const updated = await ctx.db.$transaction(async (tx) => {
      const row = await tx.settings.update({
        where: { id: 1 },
        data: { sim_day_offset: { increment: input.days }, settings_version: { increment: 1 } },
      });
      await tx.settingsHistory.create({
        data: {
          settings_version: row.settings_version,
          changed_by: ctx.actor.userId,
          changes: { sim_day_offset: { from: s.sim_day_offset, to: row.sim_day_offset } },
        },
      });
      return row;
    });
    const r = await runDailyJob(ctx);
    return { ok: true as const, done: true, simDayOffset: updated.sim_day_offset, ...r };
  },
});

export const setDemoSettings = defineHandler({
  auth: OPS,
  input: SetDemoSettingsInput,
  output: z.object({
    ok: z.literal(true),
    simDayOffset: z.number(),
    simulatePayoutFailure: z.boolean(),
  }),
  async run(ctx, input) {
    const s = await loadSettings(ctx.db);
    assertDemo(ctx, s);
    const data = {
      ...(input.simulatePayoutFailure !== undefined
        ? { simulate_payout_failure: input.simulatePayoutFailure }
        : {}),
      ...(input.resetClock ? { sim_day_offset: 0 } : {}),
    };
    const row = await ctx.db.$transaction(async (tx) => {
      const updated = await tx.settings.update({
        where: { id: 1 },
        data: { ...data, settings_version: { increment: 1 } },
      });
      await tx.settingsHistory.create({
        data: {
          settings_version: updated.settings_version,
          changed_by: ctx.actor.userId,
          changes: data,
        },
      });
      return updated;
    });
    return {
      ok: true as const,
      simDayOffset: row.sim_day_offset,
      simulatePayoutFailure: row.simulate_payout_failure,
    };
  },
});

export const recalcLiquidityCommand = defineHandler({
  auth: OPS,
  input: EmptyInput,
  output: JobResultOutput,
  run: async (ctx) => ok(await recalcLiquidity(ctx)),
});

export const processOutboxCommand = defineHandler({
  auth: OPS,
  input: EmptyInput,
  output: JobResultOutput,
  run: async (ctx) => ok({ sent: await processOutbox(ctx) }),
});

export const expireCheckoutHoldsCommand = defineHandler({
  auth: OPS,
  input: EmptyInput,
  output: JobResultOutput,
  run: async (ctx) => ok(await expireCheckoutHolds(ctx)),
});

/** O-07: one more attempt for a held payout; success resolves its payment-hold exception. */
export const retryPayout = defineHandler({
  auth: OPS,
  input: RetryPayoutInput,
  output: z.object({ ok: z.literal(true), status: z.string(), attempts: z.number() }),
  async run(ctx, input) {
    const r = await runPayoutAttempt(ctx, input.payoutId);
    if (r.status === "paid") {
      await ctx.db.exceptionCase.updateMany({
        where: { type: "payment_hold", related_id: input.payoutId, status: "open" },
        data: { status: "resolved", resolution: "Paid on retry." },
      });
    }
    return { ok: true as const, ...r };
  },
});

export const getJobsBoard = defineHandler({
  auth: OPS,
  input: EmptyInput,
  output: JobsBoardView,
  async run(ctx) {
    const s = await loadSettings(ctx.db);
    const day = businessDate(ctx.now, s);
    const runs = await ctx.db.jobRun.findMany({ orderBy: { started_at: "desc" }, take: 15 });
    const held = await ctx.db.payout.findMany({
      where: { status: "failed" },
      orderBy: { updated_date: "desc" },
      take: 20,
    });
    return {
      businessDate: day,
      realDate: istDate(ctx.now),
      simDayOffset: s.sim_day_offset,
      demoMode: s.demo_mode,
      demoToolsEnabled: ctx.env.demoToolsEnabled,
      isPlatformAdmin: ctx.actor.isPlatformAdmin,
      simulatePayoutFailure: s.simulate_payout_failure,
      dailyRanToday: runs.some(
        (r) => r.job === "daily" && toIsoDate(r.business_date) === day && r.status === "done",
      ),
      runs: runs.map((r) => ({
        job: r.job,
        businessDate: toIsoDate(r.business_date),
        status: r.status,
        startedAt: r.started_at.toISOString(),
        finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
        counts: (r.counts ?? {}) as Record<string, number>,
      })),
      pendingEmails: await ctx.db.outbox.count({ where: { status: "pending" } }),
      heldPayouts: held.map((p) => ({
        payoutId: p.id,
        type: p.type,
        amount: p.amount,
        attempts: p.attempts,
        reason: p.failure_reason,
      })),
    };
  },
});

export const getMailLog = defineHandler({
  auth: OPS,
  input: EmptyInput,
  output: MailLogView,
  async run(ctx) {
    const rows = await ctx.db.outbox.findMany({ orderBy: { created_date: "desc" }, take: 100 });
    return {
      messages: rows.map((m) => ({
        id: m.id,
        to: m.to_email,
        event: m.event,
        subject: m.subject,
        body: m.body,
        status: m.status,
        createdAt: m.created_date.toISOString(),
        sentAt: m.sent_at ? m.sent_at.toISOString() : null,
      })),
    };
  },
});

// --------------------------------------------------------------------------- notifications (X-04)

export const getNotifications = defineHandler({
  auth: "signed_in",
  input: NotificationsInput,
  output: NotificationsView,
  async run(ctx, input) {
    const where = { user_id: ctx.actor.userId, ...(input.unread ? { read: false } : {}) };
    const [items, unreadCount] = await Promise.all([
      ctx.db.notification.findMany({
        where,
        orderBy: { created_date: "desc" },
        take: input.limit ?? 50,
      }),
      ctx.db.notification.count({ where: { user_id: ctx.actor.userId, read: false } }),
    ]);
    return {
      unreadCount,
      items: items.map((n) => ({
        id: n.id,
        event: n.event,
        title: n.title,
        body: n.body,
        link: n.link,
        read: n.read,
        createdAt: n.created_date.toISOString(),
      })),
    };
  },
});

/** The read flag is the only thing a user may write on their notifications. */
export const markNotificationsRead = defineHandler({
  auth: "signed_in",
  input: MarkNotificationsReadInput,
  output: z.object({ ok: z.literal(true), updated: z.number() }),
  async run(ctx, input) {
    if (!input.all && !input.ids?.length)
      throw new DomainError(400, "nothing_to_mark", "Choose notifications to mark as read.");
    const r = await ctx.db.notification.updateMany({
      where: {
        user_id: ctx.actor.userId,
        read: false,
        ...(input.all ? {} : { id: { in: input.ids ?? [] } }),
      },
      data: { read: true },
    });
    return { ok: true as const, updated: r.count };
  },
});

export const jobViews: Record<string, AnyHandler> = { getJobsBoard, getMailLog, getNotifications };
export const jobCommands: Record<string, AnyHandler> = {
  runDailyJobs,
  advanceDemoClock,
  setDemoSettings,
  recalcLiquidity: recalcLiquidityCommand,
  processOutbox: processOutboxCommand,
  expireCheckoutHolds: expireCheckoutHoldsCommand,
  retryPayout,
  markNotificationsRead,
  resetDemoData,
};

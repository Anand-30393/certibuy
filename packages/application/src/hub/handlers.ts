// Technician counter (T-01 … T-07) and the seller's counter decision (S-14).
// Staff actions are hub-scoped; money and status are derived from records, never from the body.
import {
  CompleteHandoverInput,
  ConfirmGradeInput,
  HubJobView,
  HubQueueInput,
  HubQueueView,
  RejectDeviceInput,
  RejectForMismatchInput,
  REJECT_REASONS,
  RequestSignatureUploadInput,
  SubmissionIdInput,
  TECH_CHECKLIST,
  VerifyIdentityInput,
  type HubJobViewT,
} from "@certibuy/contracts";
import { fromIsoDate, toIsoDate, type Prisma } from "@certibuy/db";
import {
  addDays,
  confirmGrade as domainConfirmGrade,
  DomainError,
  formatInr,
  nextStepFor as verdictNextStep,
  offerExpiry,
  payoutPlan,
  planListing,
  verdictFor,
  type Grade,
} from "@certibuy/domain";
import { PRIVATE_MEDIA_BUCKET } from "@certibuy/integrations";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../actor";
import type { AppContext } from "../context";
import { runPayoutAttempt } from "../money/payouts";
import { assertHubAccess, assertOwner, canSeeAll } from "../policies";
import { defineHandler, type AnyHandler } from "../registry";
import { buildOffer } from "../selling/offer";
import { hubReturnQueue } from "../buying/handlers";
import { exposureFor, liquidityFor, STEP_PATH, today } from "../selling/queries";
import { loadSettings } from "../settings";
import { logActivity, notify, type Tx } from "../support";

const STAFF = ["technician", "ops"] as const;
const COUNTER = ["customer", "technician", "ops"] as const;
const TRUST_PENALTY = 10; // Assumption: trust score drop per two-grade mismatch (not in the docs).

const jobInclude = {
  device_model: true,
  seller: { select: { full_name: true, email: true, phone: true } },
  offers: { orderBy: { version: "desc" } },
  grade_assessments: { where: { source: "ai" }, orderBy: { created_date: "desc" }, take: 1 },
  // Latest booking of any status: it fixes the hub for scoping, even after a cancellation.
  bookings: {
    orderBy: { created_date: "desc" },
    take: 1,
    include: { hub: true },
  },
  inspection_reports: { where: { type: "intake" }, orderBy: { created_date: "desc" }, take: 1 },
  device: { include: { listings: { orderBy: { created_date: "desc" }, take: 1 }, payouts: true } },
} satisfies Prisma.SubmissionInclude;
type Job = Prisma.SubmissionGetPayload<{ include: typeof jobInclude }>;

const deviceName = (m: { brand: string; model: string; storage: string }) =>
  `${m.brand} ${m.model} ${m.storage}`;

/** Load a counter job and enforce hub scope (staff) or ownership (seller). */
async function loadJob(tx: Tx, actor: Actor, submissionId: string): Promise<Job> {
  // Row lock: two submits of the same counter step (double click, retry) run one after the other,
  // so the second sees the new status and is refused instead of writing fees or payouts twice.
  await tx.$executeRaw`SELECT id FROM submissions WHERE id = ${submissionId} FOR UPDATE`;
  const job = await tx.submission.findUnique({ where: { id: submissionId }, include: jobInclude });
  if (!job) throw new DomainError(404, "not_found", "We couldn't find that job.");
  const booking = job.bookings[0];
  if (!booking) throw new DomainError(409, "no_booking", "This deal has no hub booking.");
  if (actor.appRole === "customer" && !actor.isPlatformAdmin) assertOwner(actor, job.seller_id);
  else assertHubAccess(actor, booking.hub_id);
  return job;
}

function hubOf(job: Job) {
  const booking = job.bookings[0];
  if (!booking) throw new DomainError(409, "no_booking", "This deal has no hub booking.");
  return booking;
}

const acceptedOffer = (job: Job) => job.offers.find((o) => o.status === "accepted") ?? null;
const activeOffer = (job: Job) => job.offers.find((o) => o.status === "active") ?? null;

function agreedAmount(
  offer: { guaranteed_price: number; instant_cash_amount: number | null } | null,
  option: string | null,
): number | null {
  if (!offer) return null;
  return option === "instant_cash" ? offer.instant_cash_amount : offer.guaranteed_price;
}

function nextStep(job: Job): HubJobViewT["nextStep"] {
  if (job.device) return "done";
  if (job.status === "rejected" || job.status === "abandoned") return "closed";
  const report = job.inspection_reports[0];
  if (job.status === "scheduled") return report?.identity_passed ? "checklist" : "identity";
  if (job.status === "inspected") return "decision";
  if (job.status === "accepted") return "handover";
  return "closed";
}

function toJobView(job: Job, mismatchFee: number): HubJobViewT {
  const booking = hubOf(job);
  const report = job.inspection_reports[0] ?? null;
  const ai = job.grade_assessments[0] ?? null;
  const offer = acceptedOffer(job) ?? activeOffer(job);
  const listing = job.device?.listings[0] ?? null;
  const counterPayout = job.device?.payouts.find(
    (p) => p.type === "instant_cash_full" || p.type === "advance",
  );
  return {
    submissionId: job.id,
    status: job.status,
    rejectReason: job.reject_reason,
    hub: { id: booking.hub.id, name: booking.hub.name },
    booking: { date: toIsoDate(booking.date), slot: booking.slot, status: booking.status },
    seller: { name: job.seller.full_name || job.seller.email || "Seller", phone: job.seller.phone },
    device: {
      brand: job.device_model.brand,
      model: job.device_model.model,
      storage: job.device_model.storage,
      category: job.device_model.category,
      colour: job.colour,
      // Staff scan the full IMEI themselves; only the last 4 digits are shown for orientation.
      declaredImeiLast4: job.imei ? job.imei.slice(-4) : null,
    },
    ai: {
      band: ai?.band ?? [],
      estimate: ai?.estimate ?? null,
      confidence: ai?.confidence_level ?? null,
    },
    option: job.chosen_option,
    agreedAmount: agreedAmount(offer, job.chosen_option),
    inspection: report
      ? {
          identityPassed: report.identity_passed,
          imeiMatch:
            report.scanned_imei && job.imei
              ? report.scanned_imei.slice(-8) === job.imei.slice(-8)
              : null,
          blacklistClear: report.blacklist_clear,
          activationLockOff: report.activation_lock_off,
          checklist: (report.checklist ?? {}) as Record<string, string>,
          batteryHealth: report.battery_health,
          cosmeticGrade: report.cosmetic_grade,
          componentGrades: (report.component_grades ?? null) as Record<string, Grade> | null,
          finalGrade: report.computed_grade,
          verdict: report.verdict,
          quoted: report.quoted_amount,
          revised: report.revised_amount,
          sellerDecision: report.seller_decision,
          sealed: report.sealed,
          tagId: report.tag_id,
        }
      : null,
    handover: job.device
      ? {
          deviceId: job.device.id,
          tagId: job.device.tag_id,
          listingId: listing?.id ?? null,
          listingPrice: listing?.base_price ?? null,
          warrantyMonths: listing?.warranty_months ?? null,
          paid: counterPayout?.amount ?? 0,
          payoutStatus: counterPayout?.status ?? "pending",
        }
      : null,
    nextStep: nextStep(job),
    mismatchFee,
  };
}

// --------------------------------------------------------------------------- views

/** T-01: the hub's bookings for a day. Technicians see their own hub only. */
export const getHubQueue = defineHandler({
  auth: STAFF,
  input: HubQueueInput,
  output: HubQueueView,
  async run(ctx, input) {
    const s = await loadSettings(ctx.db);
    const day = today(ctx, s);
    const date = input.date ?? day;
    const hubs = await ctx.db.hub.findMany({ where: { active: true }, orderBy: { name: "asc" } });
    const hubId = canSeeAll(ctx.actor) ? (input.hubId ?? hubs[0]?.id ?? null) : ctx.actor.hubId;
    const hub = hubs.find((h) => h.id === hubId) ?? null;
    const bookings = hub
      ? await ctx.db.booking.findMany({
          where: {
            hub_id: hub.id,
            date: fromIsoDate(date),
            status: { in: ["booked", "completed"] },
          },
          orderBy: { slot: "asc" },
          include: {
            submission: {
              include: {
                device_model: true,
                seller: { select: { full_name: true, email: true } },
                grade_assessments: {
                  where: { source: "ai" },
                  orderBy: { created_date: "desc" },
                  take: 1,
                },
              },
            },
          },
        })
      : [];
    return {
      hub: hub ? { id: hub.id, name: hub.name, city: hub.city } : null,
      hubs: canSeeAll(ctx.actor) ? hubs.map((h) => ({ id: h.id, name: h.name })) : [],
      today: day,
      date,
      days: [0, 1, 2, 3, 4, 5].map((n) => addDays(day, n)),
      returns: hub ? await hubReturnQueue(ctx.db, hub.id) : [],
      jobs: bookings.map((b) => ({
        submissionId: b.submission_id,
        bookingId: b.id,
        slot: b.slot,
        date: toIsoDate(b.date),
        sellerName: b.submission.seller.full_name || b.submission.seller.email || "Seller",
        device: deviceName(b.submission.device_model),
        aiBand: b.submission.grade_assessments[0]?.band ?? [],
        confidence: b.submission.grade_assessments[0]?.confidence_level ?? null,
        option: b.submission.chosen_option,
        status: b.submission.status,
        bookingStatus: b.status,
      })),
    };
  },
});

/** T-02 … T-06: everything one counter visit needs, with the next allowed step. */
export const getHubJob = defineHandler({
  auth: STAFF,
  input: SubmissionIdInput,
  output: HubJobView,
  async run(ctx, input) {
    const s = await loadSettings(ctx.db);
    return toJobView(await loadJob(ctx.db, ctx.actor, input.submissionId), s.mismatch_fee);
  },
});

// --------------------------------------------------------------------------- commands

async function intakeReport(tx: Tx, job: Job, actor: Actor) {
  const existing = job.inspection_reports[0];
  if (existing) return existing;
  return tx.inspectionReport.create({
    data: {
      type: "intake",
      submission_id: job.id,
      hub_id: hubOf(job).hub_id,
      technician_id: actor.userId,
      ai_band: job.grade_assessments[0]?.band ?? [],
    },
  });
}

/** T-02: scanned vs declared IMEI (last 8 digits), blacklist lookup, activation lock. */
export const verifyIdentity = defineHandler({
  auth: STAFF,
  input: VerifyIdentityInput,
  output: z.object({
    ok: z.literal(true),
    passed: z.boolean(),
    imeiMatch: z.boolean(),
    blacklisted: z.boolean(),
    activationLockOff: z.boolean(),
  }),
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const job = await loadJob(tx, ctx.actor, input.submissionId);
      if (job.status !== "scheduled") {
        throw new DomainError(
          409,
          "not_at_identity",
          "Identity has already been checked for this visit.",
        );
      }
      const imeiMatch = Boolean(job.imei) && input.scannedImei.slice(-8) === job.imei?.slice(-8);
      // Re-check the registry at the counter, not only at submission (docs/vendor-architecture §5).
      const blacklisted = Boolean(
        await tx.blacklistedImei.findUnique({ where: { imei: input.scannedImei } }),
      );
      const passed = imeiMatch && !blacklisted && input.activationLockOff;
      const report = await intakeReport(tx, job, ctx.actor);
      await tx.inspectionReport.update({
        where: { id: report.id },
        data: {
          scanned_imei: input.scannedImei,
          blacklist_clear: !blacklisted,
          activation_lock_off: input.activationLockOff,
          identity_passed: passed,
          technician_id: ctx.actor.userId,
        },
      });
      await logActivity(tx, {
        actor: ctx.actor,
        text: passed
          ? "Identity and IMEI checked at the counter."
          : `Identity check failed at the counter (${!imeiMatch ? "IMEI mismatch" : blacklisted ? "blacklisted IMEI" : "activation lock on"}).`,
        entity: "submission",
        entityId: job.id,
        businessDate: today(ctx, s),
      });
      return {
        ok: true as const,
        passed,
        imeiMatch,
        blacklisted,
        activationLockOff: input.activationLockOff,
      };
    });
  },
});

/** Revised offer at the confirmed grade (T-05). Reuses an active offer already pricing that grade. */
async function createRevisedOffer(
  ctx: AppContext & { actor: Actor },
  tx: Tx,
  job: Job,
  finalGrade: Grade,
) {
  const existing = activeOffer(job);
  if (existing && existing.priced_band.length === 1 && existing.priced_band[0] === finalGrade) {
    return { offer: existing, reused: true, option: job.chosen_option ?? "sell_for_more" };
  }
  const s = await loadSettings(tx);
  const day = today(ctx, s);
  const liquidity = await liquidityFor(tx, job.device_model, s, day);
  const exposure = await exposureFor(tx, job.device_model.id);
  const built = buildOffer(
    {
      model: job.device_model,
      estimate: finalGrade,
      band: [finalGrade],
      confidence: "High",
      score: liquidity.score,
      launchWindow: liquidity.launchWindow,
      icPaused: job.device_model.ic_paused,
      ...exposure,
    },
    s,
  );
  // Assumption: if Instant Cash is no longer available at the lower grade, the revised offer is
  // made on the guaranteed price.
  const option =
    job.chosen_option === "instant_cash" && built.icEligible ? "instant_cash" : "sell_for_more";
  const offer = await tx.offer.create({
    data: {
      submission_id: job.id,
      seller_id: job.seller_id,
      version: (job.offers[0]?.version ?? 0) + 1,
      priced_band: [finalGrade],
      instant_cash_amount: built.icEligible ? built.instantCash : null,
      guaranteed_price: built.guaranteed,
      ic_eligible: built.icEligible,
      ic_reason: built.icReason,
      risk_pct: built.riskPct,
      risk_tier: built.riskTier,
      breakdown: {
        market: built.market,
        commission: built.commission,
        inspectionFee: built.inspectionFee,
        risk: built.risk,
        advance: built.advance,
        balance: built.balance,
        instantCashQuote: built.instantCash,
        icReasonLabel: built.icReasonLabel,
        revisedAtCounter: true,
      },
      settings_version: (await tx.settings.findUniqueOrThrow({ where: { id: 1 } }))
        .settings_version,
      expires_at: fromIsoDate(offerExpiry(day, s)),
    },
  });
  if (option !== job.chosen_option) {
    await tx.submission.update({ where: { id: job.id }, data: { chosen_option: option } });
  }
  return { offer, reused: false, option };
}

/** T-03/T-04: checklist → component grades → final grade → verdict; seals the report. */
export const confirmGrade = defineHandler({
  auth: STAFF,
  input: ConfirmGradeInput,
  output: z.object({
    ok: z.literal(true),
    finalGrade: z.string(),
    componentGrades: z.record(z.string(), z.string()),
    worstKey: z.string(),
    band: z.array(z.string()),
    verdict: z.string(),
    quoted: z.number().nullable(),
    revised: z.number().nullable(),
    next: z.string(),
  }),
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const day = today(ctx, s);
      const job = await loadJob(tx, ctx.actor, input.submissionId);
      const report = job.inspection_reports[0];
      if (job.status !== "scheduled" || !report?.identity_passed) {
        throw new DomainError(409, "identity_first", "Complete the identity check first.");
      }
      const missing = TECH_CHECKLIST.filter((c) => !input.checklist[c.key]);
      if (missing.length)
        throw new DomainError(400, "checklist_incomplete", "Answer every checklist item.");
      const failed = TECH_CHECKLIST.filter((c) => input.checklist[c.key] === "fail").length;

      const g = domainConfirmGrade(
        {
          failedChecks: failed,
          batteryHealth: input.batteryHealth,
          cosmeticGrade: input.cosmeticGrade,
        },
        s,
      );
      const band = (job.grade_assessments[0]?.band ?? report.ai_band) as Grade[];
      const verdict = verdictFor(band, g.finalGrade);
      const quoted = agreedAmount(acceptedOffer(job), job.chosen_option);

      let revised: number | null = quoted;
      let status: "accepted" | "inspected" = "inspected";
      let decision: "accepted" | "pending" | "fee_due" = "pending";
      if (verdict === "inside") {
        status = "accepted";
        decision = "accepted";
      } else if (verdict === "one_below") {
        const r = await createRevisedOffer(ctx, tx, job, g.finalGrade);
        revised = agreedAmount(r.offer, r.option);
      } else {
        revised = null;
        decision = "fee_due";
      }

      await tx.inspectionReport.update({
        where: { id: report.id },
        data: {
          checklist: input.checklist,
          battery_health: input.batteryHealth,
          cosmetic_grade: input.cosmeticGrade,
          computed_grade: g.finalGrade,
          component_grades: g.componentGrades,
          ai_band: band,
          verdict,
          quoted_amount: quoted,
          revised_amount: revised,
          seller_decision: decision,
          sealed: true,
          sealed_at: ctx.now,
          technician_id: ctx.actor.userId,
        },
      });
      await tx.gradeAssessment.create({
        data: {
          submission_id: job.id,
          seller_id: job.seller_id,
          source: "technician",
          band: [g.finalGrade],
          estimate: g.finalGrade,
          confidence: 100,
          confidence_level: "High",
          factors: { componentGrades: g.componentGrades, failedChecks: failed },
          final_grade: g.finalGrade,
          set_by: ctx.actor.userId,
          component_grades: g.componentGrades,
        },
      });
      await tx.submission.update({
        where: { id: job.id },
        data: { status, final_grade: g.finalGrade },
      });
      const verdictText = {
        inside: "inside the quoted range — the price stands",
        one_below: `one grade below — revised offer ${revised !== null ? formatInr(revised) : ""}`,
        two_below: "two or more grades below — mismatch",
      }[verdict];
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Technician confirmed grade ${g.finalGrade} (${verdictText}).`,
        entity: "submission",
        entityId: job.id,
        businessDate: day,
      });
      if (verdict === "one_below") {
        await notify(
          tx,
          [
            {
              userId: job.seller_id,
              event: "revised_offer",
              title: "Revised offer at the counter",
              body: `Your device was graded ${g.finalGrade}. New price: ${revised !== null ? formatInr(revised) : "—"}. Accept or decline at the counter.`,
              link: STEP_PATH.tracker(job.id),
            },
          ],
          ctx.env.appPublicUrl,
        );
      }
      return {
        ok: true as const,
        finalGrade: g.finalGrade,
        componentGrades: g.componentGrades,
        worstKey: g.worstKey,
        band,
        verdict,
        quoted,
        revised,
        next: verdictNextStep(verdict),
      };
    });
  },
});

/** T-05: (re)create the revised offer for a one-grade drop. Idempotent. */
export const reviseOffer = defineHandler({
  auth: STAFF,
  input: SubmissionIdInput,
  output: z.object({
    ok: z.literal(true),
    reused: z.boolean(),
    offerId: z.string(),
    revised: z.number().nullable(),
    option: z.string(),
  }),
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const job = await loadJob(tx, ctx.actor, input.submissionId);
      const report = job.inspection_reports[0];
      if (job.status !== "inspected" || report?.verdict !== "one_below" || !report.computed_grade) {
        throw new DomainError(
          409,
          "no_revision",
          "A revised offer applies only to a one-grade drop.",
        );
      }
      const r = await createRevisedOffer(ctx, tx, job, report.computed_grade);
      const revised = agreedAmount(r.offer, r.option);
      await tx.inspectionReport.update({
        where: { id: report.id },
        data: { revised_amount: revised },
      });
      return {
        ok: true as const,
        reused: r.reused,
        offerId: r.offer.id,
        revised,
        option: r.option,
      };
    });
  },
});

async function assertCounterDecision(job: Job) {
  const report = job.inspection_reports[0];
  if (
    job.status !== "inspected" ||
    report?.verdict !== "one_below" ||
    report.seller_decision !== "pending"
  ) {
    throw new DomainError(409, "no_decision", "There's no revised offer waiting for a decision.");
  }
  const offer = activeOffer(job);
  if (!offer)
    throw new DomainError(
      409,
      "no_offer",
      "The revised offer is missing. Ask the technician to re-create it.",
    );
  return { report, offer };
}

/** S-14: the seller accepts the revised price (recorded by the seller or the technician). */
export const acceptRevised = defineHandler({
  auth: COUNTER,
  input: SubmissionIdInput,
  output: z.object({ ok: z.literal(true), amount: z.number() }),
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const job = await loadJob(tx, ctx.actor, input.submissionId);
      const { report, offer } = await assertCounterDecision(job);
      const amount = agreedAmount(offer, job.chosen_option) ?? offer.guaranteed_price;
      await tx.offer.updateMany({
        where: { submission_id: job.id, status: "accepted" },
        data: { status: "declined" },
      });
      await tx.offer.update({ where: { id: offer.id }, data: { status: "accepted" } });
      await tx.submission.update({
        where: { id: job.id },
        data: { status: "accepted", current_offer_id: offer.id },
      });
      await tx.inspectionReport.update({
        where: { id: report.id },
        data: { seller_decision: "accepted" },
      });
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Revised price ${formatInr(amount)} accepted.`,
        entity: "submission",
        entityId: job.id,
        businessDate: today(ctx, s),
      });
      await notify(
        tx,
        [
          {
            userId: job.seller_id,
            event: "price_agreed",
            title: "Price agreed",
            body: `You accepted ${formatInr(amount)}. The technician will complete the handover.`,
            link: STEP_PATH.tracker(job.id),
          },
        ],
        ctx.env.appPublicUrl,
      );
      return { ok: true as const, amount };
    });
  },
});

/** S-14: the seller declines the revised price; the device goes back with them. Idempotent. */
export const declineRevised = defineHandler({
  auth: COUNTER,
  input: SubmissionIdInput,
  output: z.object({ ok: z.literal(true), already: z.boolean() }),
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const job = await loadJob(tx, ctx.actor, input.submissionId);
      if (job.status === "abandoned") return { ok: true as const, already: true };
      const { report, offer } = await assertCounterDecision(job);
      await tx.offer.update({ where: { id: offer.id }, data: { status: "declined" } });
      await tx.submission.update({ where: { id: job.id }, data: { status: "abandoned" } });
      await tx.inspectionReport.update({
        where: { id: report.id },
        data: { seller_decision: "declined" },
      });
      await tx.booking.update({ where: { id: hubOf(job).id }, data: { status: "cancelled" } });
      await logActivity(tx, {
        actor: ctx.actor,
        text: "Revised price declined; the device was returned to the seller.",
        entity: "submission",
        entityId: job.id,
        businessDate: today(ctx, s),
      });
      await notify(
        tx,
        [
          {
            userId: job.seller_id,
            event: "deal_abandoned",
            title: "Deal closed",
            body: "You declined the revised price and took your device back. You can start a new valuation any time.",
            link: STEP_PATH.tracker(job.id),
          },
        ],
        ctx.env.appPublicUrl,
      );
      return { ok: true as const, already: false };
    });
  },
});

/** T-05: two or more grades below the band — reject, mismatch fee, exception, trust penalty. */
export const rejectForMismatch = defineHandler({
  auth: STAFF,
  input: RejectForMismatchInput,
  output: z.object({ ok: z.literal(true), fee: z.number(), feeStatus: z.string() }),
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const day = today(ctx, s);
      const job = await loadJob(tx, ctx.actor, input.submissionId);
      const report = job.inspection_reports[0];
      if (job.status !== "inspected" || report?.verdict !== "two_below") {
        throw new DomainError(
          409,
          "not_mismatch",
          "The mismatch flow applies only to a drop of two or more grades.",
        );
      }
      const fee = s.mismatch_fee;
      const feeStatus = input.feePaid ? "paid" : "pending";
      await tx.submission.update({
        where: { id: job.id },
        data: {
          status: "rejected",
          mismatch_fee_status: feeStatus,
          reject_reason: `The device was graded ${report.computed_grade}, two or more grades below the quoted range, so we returned it.`,
        },
      });
      await tx.offer.updateMany({
        where: { submission_id: job.id, status: { in: ["active", "accepted"] } },
        data: { status: "declined" },
      });
      if (input.feePaid) {
        await tx.payout.create({
          data: {
            seller_id: job.seller_id,
            submission_id: job.id,
            type: "mismatch_fee",
            amount: fee,
            trigger: "inspection_mismatch",
            status: "paid",
            paid_at: ctx.now,
          },
        });
      }
      await tx.profile.update({
        where: { id: job.seller_id },
        data: { trust_score: { decrement: TRUST_PENALTY } },
      });
      await tx.exceptionCase.create({
        data: {
          type: "failed_inspection",
          title: `Grade mismatch: ${deviceName(job.device_model)}`,
          detail: `Quoted range ${report.ai_band.join("–")}, confirmed ${report.computed_grade}. Mismatch fee ${formatInr(fee)} ${feeStatus}.`,
          related_entity: "submission",
          related_id: job.id,
        },
      });
      await tx.inspectionReport.update({
        where: { id: report.id },
        data: { seller_decision: input.feePaid ? "fee_paid" : "fee_due" },
      });
      await tx.booking.update({ where: { id: hubOf(job).id }, data: { status: "completed" } });
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Returned for grade mismatch; mismatch fee ${formatInr(fee)} ${feeStatus}.`,
        entity: "submission",
        entityId: job.id,
        businessDate: day,
      });
      await notify(
        tx,
        [
          {
            userId: job.seller_id,
            event: "inspection_rejected",
            title: "We couldn't accept your device",
            body: `It was graded ${report.computed_grade}, well below the quoted range. A mismatch fee of ${formatInr(fee)} applies.`,
            link: STEP_PATH.tracker(job.id),
          },
          {
            userId: job.seller_id,
            event: "mismatch_fee",
            title: input.feePaid ? "Mismatch fee received" : "Mismatch fee due",
            body: `${formatInr(fee)} for the grade mismatch at the counter.`,
            link: STEP_PATH.tracker(job.id),
          },
        ],
        ctx.env.appPublicUrl,
      );
      return { ok: true as const, fee, feeStatus };
    });
  },
});

/** T-07: reject at the counter (identity, IMEI, unsafe device…), with an exception where ops must act. */
export const rejectDevice = defineHandler({
  auth: STAFF,
  input: RejectDeviceInput,
  output: z.object({ ok: z.literal(true) }),
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const job = await loadJob(tx, ctx.actor, input.submissionId);
      if (job.device || !["scheduled", "inspected", "accepted"].includes(job.status)) {
        throw new DomainError(
          409,
          "not_rejectable",
          "This deal can no longer be rejected at the counter.",
        );
      }
      const reason = REJECT_REASONS[input.reasonCode] + (input.note ? ` ${input.note}` : "");
      await tx.submission.update({
        where: { id: job.id },
        data: { status: "rejected", reject_reason: reason },
      });
      await tx.offer.updateMany({
        where: { submission_id: job.id, status: { in: ["active", "accepted"] } },
        data: { status: "declined" },
      });
      await tx.booking.update({ where: { id: hubOf(job).id }, data: { status: "completed" } });
      if (["imei_mismatch", "blacklisted", "identity_failed"].includes(input.reasonCode)) {
        await tx.exceptionCase.create({
          data: {
            type: "failed_inspection",
            title: `Counter reject: ${deviceName(job.device_model)}`,
            detail: reason,
            related_entity: "submission",
            related_id: job.id,
          },
        });
      }
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Rejected at the counter: ${reason}`,
        entity: "submission",
        entityId: job.id,
        businessDate: today(ctx, s),
      });
      await notify(
        tx,
        [
          {
            userId: job.seller_id,
            event: "inspection_rejected",
            title: "We couldn't accept your device",
            body: reason,
            link: STEP_PATH.tracker(job.id),
          },
        ],
        ctx.env.appPublicUrl,
      );
      return { ok: true as const };
    });
  },
});

/** T-06: signed URL for the seller's signature image (private storage). */
export const requestSignatureUpload = defineHandler({
  auth: STAFF,
  input: RequestSignatureUploadInput,
  output: z.object({ signedUrl: z.string(), path: z.string() }),
  async run(ctx, input) {
    const job = await loadJob(ctx.db, ctx.actor, input.submissionId);
    if (job.status !== "accepted")
      throw new DomainError(409, "not_ready", "The seller hasn't accepted a price yet.");
    return ctx.storage.createSignedUpload(
      PRIVATE_MEDIA_BUCKET,
      `signatures/${job.id}/signature-${randomUUID()}.png`,
    );
  },
});

/** T-06: seal, tag, sign — creates the Device, the payouts and (except grade D) the Listing. */
export const completeHandover = defineHandler({
  auth: STAFF,
  input: CompleteHandoverInput,
  output: z.object({
    ok: z.literal(true),
    deviceId: z.string(),
    listingId: z.string().nullable(),
    payoutId: z.string(),
    paid: z.number(),
    payoutStatus: z.string(),
    option: z.string(),
    listingPrice: z.number().nullable(),
    warrantyMonths: z.number().nullable(),
  }),
  async run(ctx, input) {
    if (!input.signaturePath.startsWith(`signatures/${input.submissionId}/`)) {
      throw new DomainError(
        400,
        "bad_signature",
        "That signature doesn't belong to this handover.",
      );
    }
    if (!(await ctx.storage.exists(PRIVATE_MEDIA_BUCKET, input.signaturePath))) {
      throw new DomainError(409, "signature_missing", "Capture the seller's signature first.");
    }
    const created = await ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const day = today(ctx, s);
      const job = await loadJob(tx, ctx.actor, input.submissionId);
      const report = job.inspection_reports[0];
      if (job.device)
        throw new DomainError(
          409,
          "already_handed_over",
          "This device has already been handed over.",
        );
      if (job.status !== "accepted" || !report?.sealed || !job.final_grade || !job.chosen_option) {
        throw new DomainError(
          409,
          "not_ready",
          "Confirm the grade and the seller's decision before handover.",
        );
      }
      if (await tx.device.findUnique({ where: { tag_id: input.tagId } })) {
        throw new DomainError(
          409,
          "tag_in_use",
          "That custody tag is already in use. Scan a new tag.",
        );
      }
      const offer = acceptedOffer(job);
      const agreed = agreedAmount(offer, job.chosen_option);
      if (!offer || agreed === null)
        throw new DomainError(409, "no_price", "There's no agreed price for this device.");

      const listingPlan = planListing("handover", job.final_grade, job.device_model, s);
      const device = await tx.device.create({
        data: {
          submission_id: job.id,
          seller_id: job.seller_id,
          device_model_id: job.device_model_id,
          colour: job.colour,
          imei: report.scanned_imei ?? job.imei ?? "",
          tag_id: input.tagId,
          final_grade: job.final_grade,
          payout_option: job.chosen_option,
          acquisition_cost: agreed,
          custody_at: fromIsoDate(day),
          hub_id: hubOf(job).hub_id,
          status: listingPlan.deviceStatus,
        },
      });
      const listing = listingPlan.listingCreated
        ? await tx.listing.create({
            data: {
              device_id: device.id,
              base_price: listingPlan.basePrice,
              current_price: listingPlan.basePrice,
              floor_price: listingPlan.floorPrice,
              listed_at: fromIsoDate(day),
              warranty_months: listingPlan.warrantyMonths,
            },
          })
        : null;

      const plan = payoutPlan(
        job.chosen_option === "instant_cash"
          ? { option: "instant_cash", instantCashAmount: agreed }
          : { option: "sell_for_more", guaranteed: agreed, custodyAt: day },
        s,
      );
      const payouts = [];
      for (const p of plan) {
        payouts.push(
          await tx.payout.create({
            data: {
              seller_id: job.seller_id,
              submission_id: job.id,
              device_id: device.id,
              type: p.type,
              amount: p.amount,
              trigger: p.trigger,
              status: p.status,
              due_on: p.dueOn ? fromIsoDate(p.dueOn) : null,
            },
          }),
        );
      }
      await tx.inspectionReport.update({
        where: { id: report.id },
        data: { tag_id: input.tagId, signature_key: input.signaturePath },
      });
      await tx.booking.update({ where: { id: hubOf(job).id }, data: { status: "completed" } });
      await tx.fileObject.create({
        data: {
          owner_id: ctx.actor.userId,
          kind: "signature",
          bucket: PRIVATE_MEDIA_BUCKET,
          key: input.signaturePath,
          content_type: "image/png",
          related_id: job.id,
        },
      });
      const counter = payouts[0];
      if (!counter) throw new DomainError(409, "no_payout", "No payout was planned.");
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Handed over and sealed with tag ${input.tagId}. ${listing ? `Listed at ${formatInr(listing.base_price)}.` : "Sent to refurbishment (grade D)."}`,
        entity: "submission",
        entityId: job.id,
        businessDate: day,
      });
      await notify(
        tx,
        [
          {
            userId: job.seller_id,
            event: "custody_complete",
            title: "Device handed over",
            body: `Thanks — your ${deviceName(job.device_model)} is with CertiBuy (tag ${input.tagId}). ${formatInr(counter.amount)} is being paid now.`,
            link: STEP_PATH.tracker(job.id),
          },
        ],
        ctx.env.appPublicUrl,
      );
      return { device, listing, counter, option: job.chosen_option };
    });

    // Pay the counter amount through the (simulated) rail after the handover is committed, so a
    // rail failure never undoes custody; failures are retried by the payout run.
    const attempt = await runPayoutAttempt(ctx, created.counter.id);
    return {
      ok: true as const,
      deviceId: created.device.id,
      listingId: created.listing?.id ?? null,
      payoutId: created.counter.id,
      paid: created.counter.amount,
      payoutStatus: attempt.status,
      option: created.option,
      listingPrice: created.listing?.base_price ?? null,
      warrantyMonths: created.listing?.warranty_months ?? null,
    };
  },
});

export const hubViews: Record<string, AnyHandler> = { getHubQueue, getHubJob };
export const hubCommands: Record<string, AnyHandler> = {
  verifyIdentity,
  confirmGrade,
  reviseOffer,
  acceptRevised,
  declineRevised,
  rejectForMismatch,
  rejectDevice,
  requestSignatureUpload,
  completeHandover,
};

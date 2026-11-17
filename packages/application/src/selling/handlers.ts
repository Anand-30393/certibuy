// Seller journey commands and views (S-01 … S-13). Every money/status change happens here,
// inside a transaction, after re-reading Settings and the records (CLAUDE.md §2).
import {
  AcceptOfferInput,
  BookInspectionInput,
  ConfirmPhotoInput,
  CreateSubmissionInput,
  DealTrackerView,
  EmptyInput,
  ManageBookingInput,
  ProfileView,
  RequestPhotoUploadInput,
  SaveDetailsInput,
  SaveDiagnosticsInput,
  SellCatalogueView,
  SellerHomeView,
  SellerPayoutsView,
  shotsFor,
  statusStyle,
  SubmissionIdInput,
  SubmissionView,
  UpdateProfileInput,
} from "@certibuy/contracts";
import { fromIsoDate, toIsoDate } from "@certibuy/db";
import {
  assess,
  checkRejects,
  DomainError,
  formatInr,
  inPriceBand,
  isValidImei,
  offerExpired,
  offerExpiry,
} from "@certibuy/domain";
import { PRIVATE_MEDIA_BUCKET } from "@certibuy/integrations";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defineHandler, type AnyHandler } from "../registry";
import { loadSettings } from "../settings";
import { lockKey, logActivity, notify } from "../support";
import { buildOffer } from "./offer";
import {
  bookingDays,
  exposureFor,
  failedFunctionChecks,
  liquidityFor,
  loadOwnSubmission,
  missingShots,
  nextStepFor,
  STEP_PATH,
  storedDiagnostics,
  storedPhotos,
  today,
  toSubmissionView,
  type StoredPhoto,
} from "./queries";

const CUSTOMER = ["customer"] as const;
const deviceName = (m: { brand: string; model: string; storage: string }) =>
  `${m.brand} ${m.model} ${m.storage}`;

function assertDraft(status: string): void {
  if (status !== "draft") {
    throw new DomainError(
      409,
      "not_editable",
      "This deal has moved on and can no longer be edited.",
    );
  }
}

// --------------------------------------------------------------------------- views

/** S-02: model picker. Models outside the price band are listed but disabled with a reason. */
export const getSellCatalogue = defineHandler({
  auth: CUSTOMER,
  input: EmptyInput,
  output: SellCatalogueView,
  async run(ctx) {
    const s = await loadSettings(ctx.db);
    const models = await ctx.db.deviceModel.findMany({
      where: { active: true },
      orderBy: [{ brand: "asc" }, { model: "asc" }, { storage: "asc" }],
    });
    return {
      models: models.map((m) => {
        const selectable = inPriceBand(m, s);
        return {
          id: m.id,
          brand: m.brand,
          model: m.model,
          storage: m.storage,
          category: m.category,
          selectable,
          reason: selectable
            ? null
            : `We buy devices worth ${formatInr(s.price_band_min)} to ${formatInr(s.price_band_max)}.`,
        };
      }),
    };
  },
});

export const getSubmission = defineHandler({
  auth: CUSTOMER,
  input: SubmissionIdInput,
  output: SubmissionView,
  async run(ctx, input) {
    const s = await loadSettings(ctx.db);
    const sub = await loadOwnSubmission(ctx.db, ctx.actor, input.submissionId);
    return toSubmissionView(ctx, ctx.db, sub, s);
  },
});

/** S-01: the seller's deals with the next action for each. */
export const getSellerHome = defineHandler({
  auth: CUSTOMER,
  input: EmptyInput,
  output: SellerHomeView,
  async run(ctx) {
    const subs = await ctx.db.submission.findMany({
      where: { seller_id: ctx.actor.userId },
      orderBy: { updated_date: "desc" },
      include: { device_model: true, offers: { orderBy: { version: "desc" }, take: 1 } },
      take: 50,
    });
    const NEXT: Record<string, string> = {
      draft: "Continue",
      graded: "View your offer",
      offer_accepted: "Book a hub slot",
      scheduled: "View booking",
    };
    return {
      deals: subs.map((sub) => {
        const offer = sub.offers[0];
        const step = nextStepFor({
          ...sub,
          grade_assessments: [],
          bookings: [],
          inspection_reports: [],
        } as never);
        const label = NEXT[sub.status];
        return {
          id: sub.id,
          device: deviceName(sub.device_model),
          status: sub.status,
          nextAction: label ? { label, href: STEP_PATH[step](sub.id) } : null,
          amount: !offer
            ? null
            : sub.chosen_option === "instant_cash"
              ? offer.instant_cash_amount
              : offer.guaranteed_price,
          updated: sub.updated_date.toISOString(),
        };
      }),
    };
  },
});

async function payoutRows(
  ctx: { db: import("../support").Tx },
  sellerId: string,
  submissionId?: string,
) {
  const payouts = await ctx.db.payout.findMany({
    where: { seller_id: sellerId, ...(submissionId ? { submission_id: submissionId } : {}) },
    orderBy: { created_date: "desc" },
    include: { submission: { include: { device_model: true } } },
  });
  return payouts.map((p) => ({
    id: p.id,
    device: p.submission ? deviceName(p.submission.device_model) : "—",
    type: p.type,
    amount: p.amount,
    status: p.status,
    trigger: p.trigger,
    dueOn: p.due_on ? toIsoDate(p.due_on) : null,
    paidAt: p.paid_at ? p.paid_at.toISOString() : null,
    failureReason: p.status === "failed" ? p.failure_reason : null,
  }));
}

/** S-13: every payout across the seller's deals. */
export const getSellerPayouts = defineHandler({
  auth: CUSTOMER,
  input: EmptyInput,
  output: SellerPayoutsView,
  async run(ctx) {
    const payouts = await payoutRows(ctx, ctx.actor.userId);
    const sum = (f: (p: (typeof payouts)[number]) => boolean) =>
      payouts.filter(f).reduce((a, p) => a + p.amount, 0);
    return {
      payouts,
      totals: {
        paid: sum((p) => p.status === "paid"),
        pending: sum((p) => ["pending", "approved", "failed"].includes(p.status)),
        due: sum((p) => p.status === "due"),
      },
    };
  },
});

/** S-11: deal tracker — status, booking, payments and timeline. */
export const getDealTracker = defineHandler({
  auth: CUSTOMER,
  input: SubmissionIdInput,
  output: DealTrackerView,
  async run(ctx, input) {
    const s = await loadSettings(ctx.db);
    const sub = await loadOwnSubmission(ctx.db, ctx.actor, input.submissionId);
    const timeline = await ctx.db.activityLog.findMany({
      where: { entity: "submission", entity_id: sub.id },
      orderBy: { created_date: "asc" },
    });
    return {
      submission: await toSubmissionView(ctx, ctx.db, sub, s),
      payouts: await payoutRows(ctx, ctx.actor.userId, sub.id),
      timeline: timeline.map((t) => ({ at: t.created_date.toISOString(), text: t.text })),
    };
  },
});

export const getProfile = defineHandler({
  auth: "signed_in",
  input: EmptyInput,
  output: ProfileView,
  async run(ctx) {
    const p = await ctx.db.profile.findUniqueOrThrow({ where: { id: ctx.actor.userId } });
    return {
      fullName: p.full_name ?? "",
      email: p.email,
      phone: p.phone ?? "",
      city: p.city ?? "",
      payoutAccount: p.payout_account ?? "",
      deliveryAddress: p.delivery_address ?? "",
      appRole: p.app_role,
    };
  },
});

// --------------------------------------------------------------------------- commands

const Ok = z.object({ ok: z.literal(true) });
const OkNext = z.object({ ok: z.literal(true), next: z.string() });

/** S-02 → S-03: start a draft for an active model inside the price band. */
export const createSubmission = defineHandler({
  auth: CUSTOMER,
  input: CreateSubmissionInput,
  output: z.object({ ok: z.literal(true), submissionId: z.string(), next: z.string() }),
  async run(ctx, input) {
    const s = await loadSettings(ctx.db);
    const model = await ctx.db.deviceModel.findUnique({ where: { id: input.deviceModelId } });
    if (!model || !model.active)
      throw new DomainError(404, "not_found", "That model isn't available.");
    if (!inPriceBand(model, s)) {
      throw new DomainError(409, "outside_band", "We don't buy this model at the moment.");
    }
    const sub = await ctx.db.submission.create({
      data: { seller_id: ctx.actor.userId, device_model_id: model.id, status: "draft" },
    });
    return { ok: true as const, submissionId: sub.id, next: STEP_PATH.details(sub.id) };
  },
});

/** S-03: device details. The IMEI is validated here and again at grading. */
export const saveSubmissionDetails = defineHandler({
  auth: CUSTOMER,
  input: SaveDetailsInput,
  output: OkNext,
  async run(ctx, input) {
    const sub = await loadOwnSubmission(ctx.db, ctx.actor, input.submissionId);
    assertDraft(sub.status);
    if (!isValidImei(input.imei)) {
      throw new DomainError(
        400,
        "invalid_imei",
        "That IMEI isn't valid. Check the 15 digits on the device or its box and enter them again.",
      );
    }
    await ctx.db.submission.update({
      where: { id: sub.id },
      data: {
        colour: input.colour,
        imei: input.imei,
        age_months: input.ageMonths,
        declared_cosmetic: input.declaredCosmetic,
        repaired: input.repaired,
        water_exposure: input.waterExposure,
        bill_box: input.billBox,
        warranty_status: input.warrantyStatus,
      },
    });
    return { ok: true as const, next: STEP_PATH.photos(sub.id) };
  },
});

/** S-04: a signed URL to upload one shot straight to private storage. */
export const requestPhotoUpload = defineHandler({
  auth: CUSTOMER,
  input: RequestPhotoUploadInput,
  output: z.object({ signedUrl: z.string(), path: z.string() }),
  async run(ctx, input) {
    const sub = await loadOwnSubmission(ctx.db, ctx.actor, input.submissionId);
    assertDraft(sub.status);
    if (!shotsFor(sub.device_model.category).some((s) => s.key === input.key)) {
      throw new DomainError(400, "unknown_shot", "That photo isn't part of this checklist.");
    }
    const path = `submissions/${sub.id}/${input.key}-${randomUUID()}.jpg`;
    return ctx.storage.createSignedUpload(PRIVATE_MEDIA_BUCKET, path);
  },
});

/** S-04: record an uploaded shot after checking the file really exists (closes audit F5). */
export const confirmPhoto = defineHandler({
  auth: CUSTOMER,
  input: ConfirmPhotoInput,
  output: z.object({ ok: z.literal(true), uploaded: z.number(), required: z.number() }),
  async run(ctx, input) {
    const sub = await loadOwnSubmission(ctx.db, ctx.actor, input.submissionId);
    assertDraft(sub.status);
    const shot = shotsFor(sub.device_model.category).find((s) => s.key === input.key);
    if (!shot || !input.path.startsWith(`submissions/${sub.id}/${input.key}-`)) {
      throw new DomainError(400, "bad_path", "That upload doesn't belong to this photo.");
    }
    if (!(await ctx.storage.exists(PRIVATE_MEDIA_BUCKET, input.path))) {
      throw new DomainError(409, "upload_missing", "The photo didn't finish uploading. Try again.");
    }
    const photos = storedPhotos(sub);
    const replacing = photos.some((p) => p.key === input.key);
    const next: StoredPhoto[] = [
      ...photos.filter((p) => p.key !== input.key),
      {
        key: input.key,
        label: shot.label,
        path: input.path,
        brightness: Math.round(input.brightness),
        at: ctx.now.toISOString(),
      },
    ];
    await ctx.db.$transaction([
      ctx.db.submission.update({
        where: { id: sub.id },
        data: {
          photos: next as never,
          retake_count: { increment: input.failedAttempts + (replacing ? 1 : 0) },
        },
      }),
      ctx.db.fileObject.upsert({
        where: { key: input.path },
        create: {
          owner_id: ctx.actor.userId,
          kind: "submission_photo",
          bucket: PRIVATE_MEDIA_BUCKET,
          key: input.path,
          content_type: "image/jpeg",
          related_id: sub.id,
        },
        update: {},
      }),
    ]);
    return {
      ok: true as const,
      uploaded: next.length,
      required: shotsFor(sub.device_model.category).length,
    };
  },
});

/** S-05: the seller's diagnostic answers and battery health (simulated device check). */
export const saveDiagnostics = defineHandler({
  auth: CUSTOMER,
  input: SaveDiagnosticsInput,
  output: Ok,
  async run(ctx, input) {
    const sub = await loadOwnSubmission(ctx.db, ctx.actor, input.submissionId);
    assertDraft(sub.status);
    await ctx.db.submission.update({
      where: { id: sub.id },
      data: { diagnostics: { checks: input.checks, batteryHealth: input.batteryHealth } },
    });
    return { ok: true as const };
  },
});

/** S-06/S-07: hard rejects, deterministic grade, then the offer. Never trusts the browser. */
export const gradeSubmission = defineHandler({
  auth: CUSTOMER,
  input: SubmissionIdInput,
  output: z.object({
    ok: z.boolean(),
    rejected: z.boolean(),
    code: z.string().nullable(),
    reason: z.string().nullable(),
    next: z.string(),
  }),
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const day = today(ctx, s);
      const sub = await loadOwnSubmission(tx, ctx.actor, input.submissionId);
      assertDraft(sub.status);
      if (!sub.imei || !sub.declared_cosmetic || !sub.repaired || sub.water_exposure === null) {
        throw new DomainError(400, "details_missing", "Add the device details first.");
      }
      const missing = missingShots(sub);
      if (missing.length) {
        throw new DomainError(
          400,
          "photos_missing",
          `Add the remaining photos: ${missing.join(", ")}.`,
        );
      }
      const diag = storedDiagnostics(sub);
      if (!diag.checks || diag.batteryHealth === undefined) {
        throw new DomainError(400, "diagnostics_missing", "Run the device checks first.");
      }

      const blacklisted = Boolean(
        await tx.blacklistedImei.findUnique({ where: { imei: sub.imei } }),
      );
      const reject = checkRejects({
        imei: sub.imei,
        blacklisted,
        activationLock: diag.checks.activation_lock === "fail" ? "on" : "off",
        waterExposure: sub.water_exposure,
        repaired: sub.repaired,
      });
      if (reject) {
        await tx.submission.update({
          where: { id: sub.id },
          data: { status: "rejected", reject_reason: reject.reason },
        });
        await logActivity(tx, {
          actor: ctx.actor,
          text: `Not accepted at valuation: ${reject.reason}`,
          entity: "submission",
          entityId: sub.id,
          businessDate: day,
        });
        return {
          ok: false,
          rejected: true,
          code: reject.code,
          reason: reject.reason,
          next: STEP_PATH.result(sub.id),
        };
      }

      const a = assess(
        {
          batteryHealth: diag.batteryHealth,
          declaredCosmetic: sub.declared_cosmetic,
          failedChecks: failedFunctionChecks(diag),
          repaired: sub.repaired,
          retakeCount: sub.retake_count,
        },
        s,
      );
      const liquidity = await liquidityFor(tx, sub.device_model, s, day);
      const exposure = await exposureFor(tx, sub.device_model.id);
      const built = buildOffer(
        {
          model: sub.device_model,
          estimate: a.estimate,
          band: a.band,
          confidence: a.confidence,
          score: liquidity.score,
          launchWindow: liquidity.launchWindow,
          icPaused: sub.device_model.ic_paused,
          ...exposure,
        },
        s,
      );

      await tx.gradeAssessment.create({
        data: {
          submission_id: sub.id,
          seller_id: sub.seller_id,
          source: "ai",
          band: a.band,
          estimate: a.estimate,
          confidence: a.confidenceValue,
          confidence_level: a.confidence,
          factors: { list: a.factors, components: a.components, valueRange: built.valueRange },
        },
      });
      await tx.offer.updateMany({
        where: { submission_id: sub.id, status: "active" },
        data: { status: "expired" },
      });
      const version = (sub.offers[0]?.version ?? 0) + 1;
      const offer = await tx.offer.create({
        data: {
          submission_id: sub.id,
          seller_id: sub.seller_id,
          version,
          priced_band: a.band,
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
          },
          settings_version: (await tx.settings.findUniqueOrThrow({ where: { id: 1 } }))
            .settings_version,
          expires_at: fromIsoDate(offerExpiry(day, s)),
        },
      });
      await tx.submission.update({
        where: { id: sub.id },
        data: { status: "graded", current_offer_id: offer.id },
      });
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Valued at grade ${a.estimate} (band ${a.band.join("–")}, ${a.confidence} confidence). Guaranteed ${formatInr(built.guaranteed)}.`,
        entity: "submission",
        entityId: sub.id,
        businessDate: day,
      });
      await notify(
        tx,
        [
          {
            userId: sub.seller_id,
            event: "offer_ready",
            title: "Your offer is ready",
            body: `${deviceName(sub.device_model)}: guaranteed ${formatInr(built.guaranteed)}. The offer is valid until ${offerExpiry(day, s)}.`,
            link: STEP_PATH.offer(sub.id),
          },
        ],
        ctx.env.appPublicUrl,
      );
      return {
        ok: true,
        rejected: false,
        code: null,
        reason: null,
        next: STEP_PATH.result(sub.id),
      };
    });
  },
});

/** S-09: accept with consent. Re-checks expiry and Instant Cash eligibility under a lock. */
export const acceptOffer = defineHandler({
  auth: CUSTOMER,
  input: AcceptOfferInput,
  output: z.object({
    ok: z.literal(true),
    option: z.string(),
    amount: z.number(),
    next: z.string(),
  }),
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const day = today(ctx, s);
      const sub = await loadOwnSubmission(tx, ctx.actor, input.submissionId);
      if (sub.status !== "graded") {
        throw new DomainError(409, "not_acceptable", "This offer can't be accepted any more.");
      }
      const offer = sub.offers[0];
      if (!offer || offer.status !== "active") {
        throw new DomainError(409, "no_offer", "There's no active offer for this device.");
      }
      if (day > toIsoDate(offer.expires_at)) {
        await tx.offer.update({ where: { id: offer.id }, data: { status: "expired" } });
        await tx.submission.update({ where: { id: sub.id }, data: { status: "abandoned" } });
        throw new DomainError(
          409,
          "offer_expired",
          `This offer expired on ${toIsoDate(offer.expires_at)}. Start a new valuation to get a fresh price.`,
        );
      }

      let amount = offer.guaranteed_price;
      if (input.option === "instant_cash") {
        // Instant Cash caps are shared: serialise competing accepts (docs/architecture.md §6).
        await lockKey(tx, "instant_cash_exposure");
        const assessment = sub.grade_assessments[0];
        const liquidity = await liquidityFor(tx, sub.device_model, s, day);
        const exposure = await exposureFor(tx, sub.device_model.id);
        const built = buildOffer(
          {
            model: sub.device_model,
            estimate: assessment?.estimate ?? offer.priced_band[0] ?? "B",
            band: offer.priced_band,
            confidence: assessment?.confidence_level ?? "Low",
            score: liquidity.score,
            launchWindow: liquidity.launchWindow,
            icPaused: sub.device_model.ic_paused,
            ...exposure,
          },
          s,
        );
        if (!offer.ic_eligible || !built.icEligible || offer.instant_cash_amount === null) {
          await tx.offer.update({
            where: { id: offer.id },
            data: { ic_eligible: false, ic_reason: built.icReason ?? offer.ic_reason },
          });
          await notify(
            tx,
            [
              {
                userId: sub.seller_id,
                event: "ic_withdrawn",
                title: "Instant Cash is no longer available",
                body: "The guaranteed price is still available for your device.",
                link: STEP_PATH.offer(sub.id),
              },
            ],
            ctx.env.appPublicUrl,
          );
          throw new DomainError(
            409,
            "ic_unavailable",
            built.icReason ??
              "Instant Cash isn't available for this device. Choose the guaranteed price.",
          );
        }
        amount = offer.instant_cash_amount;
      }

      await tx.offer.updateMany({
        where: { submission_id: sub.id, status: "active", NOT: { id: offer.id } },
        data: { status: "expired" },
      });
      // An accepted offer must be handed over within offer_expiry_days of acceptance (decision
      // 2026-11-17); after that the daily job closes the deal.
      const handoverBy = offerExpiry(day, s);
      await tx.offer.update({
        where: { id: offer.id },
        data: { status: "accepted", expires_at: fromIsoDate(handoverBy) },
      });
      await tx.submission.update({
        where: { id: sub.id },
        data: { status: "offer_accepted", chosen_option: input.option, consent_at: ctx.now },
      });
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Accepted ${statusStyle("payout_option", input.option).label} at ${formatInr(amount)}.`,
        entity: "submission",
        entityId: sub.id,
        businessDate: day,
      });
      return { ok: true as const, option: input.option, amount, next: STEP_PATH.hub(sub.id) };
    });
  },
});

/** S-12: book a hub slot in the next five days, within the hub's daily capacity. */
export const bookInspection = defineHandler({
  auth: CUSTOMER,
  input: BookInspectionInput,
  output: OkNext,
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const day = today(ctx, s);
      const sub = await loadOwnSubmission(tx, ctx.actor, input.submissionId);
      if (sub.status !== "offer_accepted" && sub.status !== "scheduled") {
        throw new DomainError(409, "not_bookable", "Accept your offer before booking a hub slot.");
      }
      if (!sub.chosen_option) {
        throw new DomainError(409, "no_option", "Choose how you'd like to be paid first.");
      }
      const accepted = sub.offers[0];
      if (accepted?.status === "accepted") {
        const handoverBy = toIsoDate(accepted.expires_at);
        if (offerExpired(handoverBy, day)) {
          throw new DomainError(
            409,
            "offer_expired",
            "Your accepted offer expired before handover. Start a new valuation for a fresh price.",
          );
        }
        if (input.date > handoverBy) {
          throw new DomainError(
            422,
            "after_expiry",
            `Choose a day on or before ${handoverBy}, when your offer expires.`,
          );
        }
      }
      const hub = await tx.hub.findUnique({ where: { id: input.hubId } });
      if (!hub || !hub.active)
        throw new DomainError(404, "hub_unavailable", "That hub isn't taking bookings.");
      if (!bookingDays(day).includes(input.date)) {
        throw new DomainError(422, "bad_day", "Choose a day within the next five days.");
      }
      if (!hub.slot_times.includes(input.slot)) {
        throw new DomainError(422, "bad_slot", "That time isn't available at this hub.");
      }

      await lockKey(tx, `booking:${hub.id}:${input.date}`);
      const taken = await tx.booking.count({
        where: {
          hub_id: hub.id,
          date: fromIsoDate(input.date),
          status: "booked",
          NOT: { submission_id: sub.id },
        },
      });
      if (taken >= hub.daily_capacity) {
        throw new DomainError(
          409,
          "slot_taken",
          "That day just filled up. Choose another day or hub.",
        );
      }

      await tx.booking.updateMany({
        where: { submission_id: sub.id, status: "booked" },
        data: { status: "cancelled" },
      });
      await tx.booking.create({
        data: {
          submission_id: sub.id,
          hub_id: hub.id,
          seller_id: sub.seller_id,
          date: fromIsoDate(input.date),
          slot: input.slot,
        },
      });
      await tx.submission.update({ where: { id: sub.id }, data: { status: "scheduled" } });
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Booked ${hub.name} on ${input.date} at ${input.slot}.`,
        entity: "submission",
        entityId: sub.id,
        businessDate: day,
      });
      await notify(
        tx,
        [
          {
            userId: sub.seller_id,
            event: "booking_confirmed",
            title: "Your hub visit is booked",
            body: `${hub.name}, ${input.date} at ${input.slot}. Bring the device, its charger if you have it, and photo ID.`,
            link: STEP_PATH.tracker(sub.id),
          },
        ],
        ctx.env.appPublicUrl,
      );
      return { ok: true as const, next: STEP_PATH.tracker(sub.id) };
    });
  },
});

/** S-12 (edit): switch Instant Cash to the guaranteed price, or cancel the booking. */
export const manageBooking = defineHandler({
  auth: CUSTOMER,
  input: ManageBookingInput,
  output: OkNext,
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const day = today(ctx, s);
      const sub = await loadOwnSubmission(tx, ctx.actor, input.submissionId);
      if (sub.status !== "offer_accepted" && sub.status !== "scheduled") {
        throw new DomainError(409, "not_editable", "This deal can no longer be changed.");
      }
      if (input.action === "switch_to_guaranteed") {
        if (sub.chosen_option === "sell_for_more") {
          throw new DomainError(
            409,
            "already_guaranteed",
            "You're already on the guaranteed price.",
          );
        }
        await tx.submission.update({
          where: { id: sub.id },
          data: { chosen_option: "sell_for_more" },
        });
        await logActivity(tx, {
          actor: ctx.actor,
          text: "Switched from Instant Cash to Sell For More.",
          entity: "submission",
          entityId: sub.id,
          businessDate: day,
        });
        await notify(
          tx,
          [
            {
              userId: sub.seller_id,
              event: "option_switched",
              title: "You're now on Sell For More",
              body: "You'll get 50% at the counter and the rest when it sells or on day 21.",
              link: STEP_PATH.tracker(sub.id),
            },
          ],
          ctx.env.appPublicUrl,
        );
        return { ok: true as const, next: STEP_PATH.tracker(sub.id) };
      }
      await tx.booking.updateMany({
        where: { submission_id: sub.id, status: "booked" },
        data: { status: "cancelled" },
      });
      await tx.submission.update({ where: { id: sub.id }, data: { status: "offer_accepted" } });
      await logActivity(tx, {
        actor: ctx.actor,
        text: "Hub booking cancelled.",
        entity: "submission",
        entityId: sub.id,
        businessDate: day,
      });
      await notify(
        tx,
        [
          {
            userId: sub.seller_id,
            event: "booking_cancelled",
            title: "Your hub booking was cancelled",
            body: "Book a new slot any time before your offer expires.",
            link: STEP_PATH.hub(sub.id),
          },
        ],
        ctx.env.appPublicUrl,
      );
      return { ok: true as const, next: STEP_PATH.hub(sub.id) };
    });
  },
});

/** X-06: profile details. Roles, hub and trust fields are never writable here. */
export const updateProfile = defineHandler({
  auth: "signed_in",
  input: UpdateProfileInput,
  output: Ok,
  async run(ctx, input) {
    await ctx.db.profile.update({
      where: { id: ctx.actor.userId },
      data: {
        full_name: input.fullName,
        phone: input.phone || null,
        city: input.city || null,
        payout_account: input.payoutAccount || null,
        delivery_address: input.deliveryAddress || null,
      },
    });
    return { ok: true as const };
  },
});

export const sellingViews: Record<string, AnyHandler> = {
  getSellCatalogue,
  getSubmission,
  getSellerHome,
  getSellerPayouts,
  getDealTracker,
  getProfile,
};

export const sellingCommands: Record<string, AnyHandler> = {
  createSubmission,
  saveSubmissionDetails,
  requestPhotoUpload,
  confirmPhoto,
  saveDiagnostics,
  gradeSubmission,
  acceptOffer,
  bookInspection,
  manageBooking,
  updateProfile,
};

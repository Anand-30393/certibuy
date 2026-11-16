// Seller read helpers: load an owned submission, liquidity, exposure, wizard step, view projection.
import { shotsFor, FUNCTION_CHECKS, type SubmissionViewT } from "@certibuy/contracts";
import { fromIsoDate, toIsoDate, type Prisma } from "@certibuy/db";
import {
  addDays,
  businessDate,
  DomainError,
  inLaunchWindow,
  scoreModel,
  type Settings,
} from "@certibuy/domain";
import { PRIVATE_MEDIA_BUCKET } from "@certibuy/integrations";
import type { Actor } from "../actor";
import type { AppContext } from "../context";
import { assertOwner } from "../policies";
import type { Tx } from "../support";

export const submissionInclude = {
  device_model: true,
  offers: { orderBy: { version: "desc" }, take: 1 },
  grade_assessments: { where: { source: "ai" }, orderBy: { created_date: "desc" }, take: 1 },
  bookings: { orderBy: { created_date: "desc" }, take: 1, include: { hub: true } },
} satisfies Prisma.SubmissionInclude;

export type LoadedSubmission = Prisma.SubmissionGetPayload<{ include: typeof submissionInclude }>;

export async function loadOwnSubmission(
  tx: Tx,
  actor: Actor,
  id: string,
): Promise<LoadedSubmission> {
  const sub = await tx.submission.findUnique({ where: { id }, include: submissionInclude });
  if (!sub) throw new DomainError(404, "not_found", "We couldn't find that deal.");
  assertOwner(actor, sub.seller_id);
  return sub;
}

export function today(ctx: Pick<AppContext, "now">, s: Settings): string {
  return businessDate(ctx.now, s);
}

export interface StoredPhoto {
  key: string;
  label: string;
  path: string;
  brightness: number;
  at: string;
}

export function storedPhotos(sub: { photos: Prisma.JsonValue }): StoredPhoto[] {
  return Array.isArray(sub.photos) ? (sub.photos as unknown as StoredPhoto[]) : [];
}

export interface StoredDiagnostics {
  checks?: Record<string, "pass" | "fail">;
  batteryHealth?: number;
}

export function storedDiagnostics(sub: { diagnostics: Prisma.JsonValue }): StoredDiagnostics {
  const d = sub.diagnostics;
  return d && typeof d === "object" && !Array.isArray(d) ? (d as StoredDiagnostics) : {};
}

export function failedFunctionChecks(d: StoredDiagnostics): number {
  return FUNCTION_CHECKS.filter((k) => d.checks?.[k] === "fail").length;
}

export function missingShots(sub: LoadedSubmission): string[] {
  const have = new Set(storedPhotos(sub).map((p) => p.key));
  return shotsFor(sub.device_model.category)
    .filter((s) => !have.has(s.key))
    .map((s) => s.label);
}

/** Current liquidity score for a model (latest row, else the tier's cold-start score). */
export async function liquidityFor(
  tx: Tx,
  model: {
    id: string;
    liquidity_tier: "high" | "medium" | "low";
    successor_launch_date: Date | null;
  },
  s: Settings,
  day: string,
): Promise<{ score: number; launchWindow: boolean }> {
  const current = await tx.liquidityScore.findFirst({
    where: { device_model_id: model.id, is_current: true },
  });
  const launchWindow = inLaunchWindow(
    model.successor_launch_date ? toIsoDate(model.successor_launch_date) : null,
    day,
    s,
  );
  const score =
    current?.score ??
    scoreModel(
      {
        tier: model.liquidity_tier,
        salesDaysToSell: [],
        achievedPriceRatios: [],
        recentSales: 0,
        activeListings: 0,
        launchWindow,
        day45Returns: 0,
      },
      s,
    ).score;
  return { score, launchWindow };
}

/** Acquisition cost of stock CertiBuy owns (not yet settled or liquidated), overall and per model. */
export async function exposureFor(
  tx: Tx,
  modelId: string,
): Promise<{ inventoryTotal: number; modelExposure: number }> {
  const owned = { status: { notIn: ["settled", "liquidated"] as ("settled" | "liquidated")[] } };
  const [all, model] = await Promise.all([
    tx.device.aggregate({ _sum: { acquisition_cost: true }, where: owned }),
    tx.device.aggregate({
      _sum: { acquisition_cost: true },
      where: { ...owned, device_model_id: modelId },
    }),
  ]);
  return {
    inventoryTotal: all._sum.acquisition_cost ?? 0,
    modelExposure: model._sum.acquisition_cost ?? 0,
  };
}

/** Booking days: the next five business days starting tomorrow (assumption: no same-day slots). */
export function bookingDays(day: string): string[] {
  return [1, 2, 3, 4, 5].map((n) => addDays(day, n));
}

export type WizardStep =
  | "details"
  | "photos"
  | "diagnostics"
  | "result"
  | "offer"
  | "hub"
  | "tracker"
  | "rejected"
  | "closed";

export function nextStepFor(sub: LoadedSubmission): WizardStep {
  switch (sub.status) {
    case "rejected":
      return "rejected";
    case "abandoned":
      return "closed";
    case "graded":
      return "offer";
    case "offer_accepted":
      return "hub";
    case "scheduled":
    case "inspected":
    case "accepted":
      return "tracker";
    case "draft": {
      if (!sub.imei) return "details";
      if (missingShots(sub).length) return "photos";
      return "diagnostics";
    }
  }
}

export const STEP_PATH: Record<WizardStep, (id: string) => string> = {
  details: (id) => `/seller/sell/${id}`,
  photos: (id) => `/seller/sell/${id}/photos`,
  diagnostics: (id) => `/seller/sell/${id}/diagnostics`,
  result: (id) => `/seller/sell/${id}/result`,
  offer: (id) => `/seller/sell/${id}/offer`,
  hub: (id) => `/seller/sell/${id}/hub`,
  tracker: (id) => `/seller/deals/${id}`,
  rejected: (id) => `/seller/sell/${id}/result`,
  closed: (id) => `/seller/deals/${id}`,
};

async function hubOptions(tx: Tx, day: string) {
  const days = bookingDays(day);
  const hubs = await tx.hub.findMany({ where: { active: true }, orderBy: { distance_km: "asc" } });
  const counts = await tx.booking.groupBy({
    by: ["hub_id", "date"],
    where: { status: "booked", date: { in: days.map(fromIsoDate) } },
    _count: { _all: true },
  });
  const used = new Map(counts.map((c) => [`${c.hub_id}|${toIsoDate(c.date)}`, c._count._all]));
  return hubs.map((h) => ({
    id: h.id,
    name: h.name,
    type: h.type,
    address: h.address,
    city: h.city,
    distanceKm: h.distance_km,
    days: days.map((date) => ({
      date,
      remaining: Math.max(0, h.daily_capacity - (used.get(`${h.id}|${date}`) ?? 0)),
      slots: h.slot_times,
    })),
  }));
}

/** The seller-safe projection of a submission (no internal numbers: floor, cost, exposure). */
export async function toSubmissionView(
  ctx: AppContext,
  tx: Tx,
  sub: LoadedSubmission,
  s: Settings,
): Promise<SubmissionViewT> {
  const day = today(ctx, s);
  const photos = storedPhotos(sub);
  const diag = storedDiagnostics(sub);
  const offer = sub.offers[0] ?? null;
  const assessment = sub.grade_assessments[0] ?? null;
  const booking = sub.bookings[0] ?? null;
  const breakdown = (offer?.breakdown ?? {}) as Record<string, number>;
  const factors = (assessment?.factors ?? {}) as {
    list?: string[];
    valueRange?: { low: number; high: number };
  };

  const photoViews = await Promise.all(
    shotsFor(sub.device_model.category).map(async (shot) => {
      const stored = photos.find((p) => p.key === shot.key);
      return {
        key: shot.key,
        label: shot.label,
        tip: shot.tip,
        uploaded: Boolean(stored),
        url: stored
          ? await ctx.storage.signedDownloadUrl(PRIVATE_MEDIA_BUCKET, stored.path, 300)
          : null,
      };
    }),
  );

  const step = nextStepFor(sub);
  return {
    id: sub.id,
    status: sub.status,
    rejectReason: sub.reject_reason,
    model: {
      id: sub.device_model.id,
      brand: sub.device_model.brand,
      model: sub.device_model.model,
      storage: sub.device_model.storage,
      category: sub.device_model.category,
      colours: sub.device_model.colours,
    },
    details: {
      colour: sub.colour,
      imei: sub.imei,
      ageMonths: sub.age_months,
      declaredCosmetic: sub.declared_cosmetic,
      repaired: sub.repaired,
      waterExposure: sub.water_exposure,
      billBox: sub.bill_box,
      warrantyStatus: sub.warranty_status,
    },
    photos: photoViews,
    retakeCount: sub.retake_count,
    diagnostics: { checks: diag.checks ?? {}, batteryHealth: diag.batteryHealth ?? null },
    assessment: assessment
      ? {
          estimate: assessment.estimate,
          band: assessment.band,
          confidence: assessment.confidence_level,
          confidenceValue: assessment.confidence,
          factors: factors.list ?? [],
          valueRange: factors.valueRange ?? { low: 0, high: 0 },
        }
      : null,
    offer: offer
      ? {
          id: offer.id,
          version: offer.version,
          band: offer.priced_band,
          guaranteedPrice: offer.guaranteed_price,
          instantCashAmount: offer.instant_cash_amount,
          icEligible: offer.ic_eligible,
          icReason: offer.ic_reason,
          icReasonLabel: (breakdown as unknown as { icReasonLabel?: string }).icReasonLabel ?? null,
          riskPct: offer.risk_pct,
          riskTier: offer.risk_tier,
          breakdown: {
            market: breakdown.market ?? 0,
            commission: breakdown.commission ?? 0,
            commissionPct: s.commission_pct,
            inspectionFee: breakdown.inspectionFee ?? 0,
            risk: breakdown.risk ?? 0,
          },
          advance: breakdown.advance ?? 0,
          balance: breakdown.balance ?? 0,
          balanceDay: s.balance_day,
          expiresAt: toIsoDate(offer.expires_at),
          status: offer.status,
        }
      : null,
    chosenOption: sub.chosen_option,
    booking: booking
      ? {
          id: booking.id,
          hubId: booking.hub_id,
          hubName: booking.hub.name,
          hubAddress: `${booking.hub.address}, ${booking.hub.city}`,
          date: toIsoDate(booking.date),
          slot: booking.slot,
          status: booking.status,
        }
      : null,
    hubs: step === "hub" || step === "tracker" ? await hubOptions(tx, day) : [],
    nextStep: step,
    businessDate: day,
    photoRules: { minPx: s.photo_min_px, minBrightness: s.photo_min_brightness },
  };
}

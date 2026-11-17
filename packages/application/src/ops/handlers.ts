// Operations console (O-01 … O-15) and customer care (X-05). Ops-only unless noted; staff
// management requires platform admin. Every write leaves an ActivityLog entry with its actor, and
// money tables are only ever appended to (corrections are compensating rows).
import {
  DomainError,
  ageBucket,
  businessDate,
  daysListed,
  formatInr,
  median,
  percent,
  planListing,
  validateSettingsPatch,
  weekIndex,
  weekStarts,
  EDITABLE_SETTINGS,
  type EditableSetting,
} from "@certibuy/domain";
import { CATEGORY, EmptyInput } from "@certibuy/contracts";
import { fromIsoDate, toIsoDate } from "@certibuy/db";
import { z } from "zod";
import { AccessDenied, type Actor } from "../actor";
import { defineHandler, type AnyHandler } from "../registry";
import { loadSettings } from "../settings";
import { logActivity, notify, type Tx } from "../support";

const OPS = ["ops"] as const;
const CUSTOMER = ["customer"] as const;
const id = z.string().min(1).max(64);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Money = z.number().int();
const deviceName = (m: { brand: string; model: string; storage: string }) =>
  `${m.brand} ${m.model} ${m.storage}`;
const orderNo = (oid: string) => `CB-${oid.slice(-6).toUpperCase()}`;
const ok = z.object({ ok: z.literal(true) });

function assertPlatformAdmin(actor: Actor) {
  if (!actor.isPlatformAdmin) {
    throw new AccessDenied(403, "admin_only", "Only a platform admin can change staff access.");
  }
}

// =========================================================================== O-01 overview, O-02 alerts

export const OpsOverviewView = z.object({
  businessDate: z.string(),
  kpis: z.object({
    listed: z.number(),
    inRefurbishment: z.number(),
    ordersLast7: z.number(),
    gmvLast30: Money,
    escrowHeld: Money,
    openReturns: z.number(),
    openExceptions: z.number(),
    payoutsOnHold: z.number(),
  }),
  stockAge: z.array(z.object({ bucket: z.string(), count: z.number() })),
  attention: z.array(z.object({ label: z.string(), count: z.number(), href: z.string() })),
  hubsToday: z.array(z.object({ hub: z.string(), bookings: z.number(), capacity: z.number() })),
  activity: z.array(z.object({ at: z.string(), actor: z.string(), text: z.string() })),
});

export const getOpsOverview = defineHandler({
  auth: OPS,
  input: EmptyInput,
  output: OpsOverviewView,
  async run(ctx) {
    const s = await loadSettings(ctx.db);
    const day = businessDate(ctx.now, s);
    const since7 = new Date(ctx.now.getTime() - 7 * 86_400_000);
    const since30 = new Date(ctx.now.getTime() - 30 * 86_400_000);
    const [
      listed,
      refurb,
      orders7,
      gmv,
      held,
      openReturns,
      openExceptions,
      onHold,
      active,
      hubs,
      bookings,
      activity,
      reviews,
    ] = await Promise.all([
      ctx.db.listing.count({ where: { status: "active" } }),
      ctx.db.device.count({ where: { status: "in_refurbishment" } }),
      ctx.db.order.count({ where: { paid_at: { gte: since7 } } }),
      ctx.db.order.aggregate({
        _sum: { total: true },
        where: { paid_at: { gte: since30 }, status: { notIn: ["cancelled", "pending"] } },
      }),
      ctx.db.order.aggregate({
        _sum: { total: true },
        where: { escrow_status: { in: ["hold", "held_replacement"] } },
      }),
      ctx.db.returnRequest.count({ where: { status: { not: "resolved" } } }),
      ctx.db.exceptionCase.count({ where: { status: "open" } }),
      ctx.db.payout.count({ where: { status: "failed" } }),
      ctx.db.listing.findMany({
        where: { status: "active" },
        select: { listed_at: true, reserved_days: true },
      }),
      ctx.db.hub.findMany({ where: { active: true } }),
      ctx.db.booking.groupBy({
        by: ["hub_id"],
        where: { date: fromIsoDate(day), status: { in: ["booked", "completed"] } },
        _count: { _all: true },
      }),
      ctx.db.activityLog.findMany({ orderBy: { created_date: "desc" }, take: 15 }),
      ctx.db.listing.count({ where: { status: "review" } }),
    ]);
    const buckets = new Map<string, number>([
      ["0-14", 0],
      ["15-29", 0],
      ["30-44", 0],
      ["45+", 0],
    ]);
    for (const l of active) {
      const b = ageBucket(daysListed(toIsoDate(l.listed_at), day, l.reserved_days), s);
      buckets.set(b, (buckets.get(b) ?? 0) + 1);
    }
    const paidNotShipped = await ctx.db.order.count({
      where: { status: "paid", paid_at: { lt: new Date(ctx.now.getTime() - 2 * 86_400_000) } },
    });
    return {
      businessDate: day,
      kpis: {
        listed,
        inRefurbishment: refurb,
        ordersLast7: orders7,
        gmvLast30: gmv._sum.total ?? 0,
        escrowHeld: held._sum.total ?? 0,
        openReturns,
        openExceptions,
        payoutsOnHold: onHold,
      },
      stockAge: [...buckets].map(([bucket, count]) => ({ bucket, count })),
      attention: [
        { label: "Open exceptions", count: openExceptions, href: "/ops/exceptions" },
        { label: "Returns to resolve", count: openReturns, href: "/ops/returns" },
        {
          label: `Day-${s.review_day} reviews`,
          count: reviews,
          href: "/ops/inventory?status=day45_review",
        },
        { label: "Payouts on hold", count: onHold, href: "/ops/jobs" },
        { label: "Paid but not dispatched for 48 h", count: paidNotShipped, href: "/ops/orders" },
      ].filter((a) => a.count > 0),
      hubsToday: hubs.map((h) => ({
        hub: h.name,
        bookings: bookings.find((b) => b.hub_id === h.id)?._count._all ?? 0,
        capacity: h.daily_capacity,
      })),
      activity: activity.map((a) => ({
        at: a.created_date.toISOString(),
        actor: a.actor_name,
        text: a.text,
      })),
    };
  },
});

export const OpsAlertsView = z.object({
  groups: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      items: z.array(z.object({ text: z.string(), href: z.string() })),
    }),
  ),
});

export const getOpsAlerts = defineHandler({
  auth: OPS,
  input: EmptyInput,
  output: OpsAlertsView,
  async run(ctx) {
    const s = await loadSettings(ctx.db);
    const day = businessDate(ctx.now, s);
    const horizon = fromIsoDate(
      new Date(Date.parse(`${day}T00:00:00Z`) + s.alert_window_days * 86_400_000)
        .toISOString()
        .slice(0, 10),
    );
    const [reviews, offers, windows, paused, holds] = await Promise.all([
      ctx.db.listing.findMany({
        where: { status: "review" },
        include: { device: { include: { device_model: true } } },
      }),
      ctx.db.offer.findMany({
        where: { status: "active", expires_at: { lte: horizon, gte: fromIsoDate(day) } },
        include: { submission: { include: { device_model: true } } },
      }),
      ctx.db.order.findMany({
        where: {
          status: "delivered",
          escrow_status: "hold",
          return_window_closes_at: { lte: horizon, gte: fromIsoDate(day) },
        },
        include: { device: { include: { device_model: true } } },
      }),
      ctx.db.deviceModel.findMany({ where: { ic_paused: true, active: true } }),
      ctx.db.payout.findMany({ where: { status: "failed" } }),
    ]);
    return {
      groups: [
        {
          key: "reviews",
          title: `Day-${s.review_day} reviews`,
          items: reviews.map((l) => ({
            text: `${deviceName(l.device.device_model)} — liquidate to B2B at ${formatInr(l.floor_price)} or reprice`,
            href: "/ops/inventory?status=day45_review",
          })),
        },
        {
          key: "offers",
          title: "Offers expiring soon",
          items: offers.map((o) => ({
            text: `${deviceName(o.submission.device_model)} — expires ${toIsoDate(o.expires_at)}`,
            href: "/ops",
          })),
        },
        {
          key: "windows",
          title: "Return windows closing",
          items: windows.map((o) => ({
            text: `${orderNo(o.id)} ${deviceName(o.device.device_model)} — closes ${o.return_window_closes_at ? toIsoDate(o.return_window_closes_at) : ""}`,
            href: "/ops/orders",
          })),
        },
        {
          key: "paused",
          title: "Instant Cash paused",
          items: paused.map((m) => ({ text: deviceName(m), href: "/ops/liquidity" })),
        },
        {
          key: "holds",
          title: "Payouts on hold",
          items: holds.map((p) => ({
            text: `${p.type.replace("_", " ")} ${formatInr(p.amount)} after ${p.attempts} attempts`,
            href: "/ops/jobs",
          })),
        },
      ],
    };
  },
});

// =========================================================================== O-03 catalogue

const ModelInput = z
  .object({
    id: id.optional(),
    brand: z.string().trim().min(1).max(40),
    model: z.string().trim().min(1).max(60),
    storage: z.string().trim().min(1).max(20),
    category: CATEGORY,
    colours: z.array(z.string().trim().min(1).max(30)).min(1).max(12),
    launchDate: isoDate.nullable(),
    successorLaunchDate: isoDate.nullable(),
    originalPrice: Money.min(0).nullable(),
    marketPriceA: Money.min(1),
    marketPriceB: Money.min(1).nullable(),
    marketPriceC: Money.min(1).nullable(),
    marketPriceD: Money.min(1).nullable(),
    b2bFloorPrice: Money.min(1),
    priceIsPlaceholder: z.boolean(),
    liquidityTier: z.enum(["high", "medium", "low"]),
    active: z.boolean(),
  })
  .strict();

export const CatalogueView = z.object({
  models: z.array(ModelInput.extend({ id: z.string(), icPaused: z.boolean() })),
});

export const getCatalogue = defineHandler({
  auth: OPS,
  input: EmptyInput,
  output: CatalogueView,
  async run(ctx) {
    const models = await ctx.db.deviceModel.findMany({
      orderBy: [{ brand: "asc" }, { model: "asc" }],
    });
    return {
      models: models.map((m) => ({
        id: m.id,
        brand: m.brand,
        model: m.model,
        storage: m.storage,
        category: m.category,
        colours: m.colours,
        launchDate: m.launch_date ? toIsoDate(m.launch_date) : null,
        successorLaunchDate: m.successor_launch_date ? toIsoDate(m.successor_launch_date) : null,
        originalPrice: m.original_price,
        marketPriceA: m.market_price_a,
        marketPriceB: m.market_price_b,
        marketPriceC: m.market_price_c,
        marketPriceD: m.market_price_d,
        b2bFloorPrice: m.b2b_floor_price,
        priceIsPlaceholder: m.price_is_placeholder,
        liquidityTier: m.liquidity_tier,
        active: m.active,
        icPaused: m.ic_paused,
      })),
    };
  },
});

export const saveDeviceModel = defineHandler({
  auth: OPS,
  input: ModelInput,
  output: z.object({ ok: z.literal(true), id: z.string() }),
  async run(ctx, i) {
    const graded = [i.marketPriceA, i.marketPriceB, i.marketPriceC, i.marketPriceD].filter(
      (p): p is number => p !== null,
    );
    if (graded.some((p, k) => k > 0 && p > (graded[k - 1] as number))) {
      throw new DomainError(400, "price_order", "Grade prices must not increase from A to D.");
    }
    if (i.b2bFloorPrice > i.marketPriceA)
      throw new DomainError(400, "floor_high", "The B2B floor can't be above the grade A price.");
    const data = {
      brand: i.brand,
      model: i.model,
      storage: i.storage,
      category: i.category,
      colours: i.colours,
      launch_date: i.launchDate ? fromIsoDate(i.launchDate) : null,
      successor_launch_date: i.successorLaunchDate ? fromIsoDate(i.successorLaunchDate) : null,
      original_price: i.originalPrice,
      market_price_a: i.marketPriceA,
      market_price_b: i.marketPriceB,
      market_price_c: i.marketPriceC,
      market_price_d: i.marketPriceD,
      b2b_floor_price: i.b2bFloorPrice,
      price_is_placeholder: i.priceIsPlaceholder,
      liquidity_tier: i.liquidityTier,
      active: i.active,
    };
    return ctx.db.$transaction(async (tx) => {
      const row = i.id
        ? await tx.deviceModel.update({ where: { id: i.id }, data })
        : await tx.deviceModel.create({ data });
      await logActivity(tx, {
        actor: ctx.actor,
        text: `${i.id ? "Updated" : "Added"} catalogue model ${deviceName(row)}.`,
        entity: "device_model",
        entityId: row.id,
        businessDate: businessDate(ctx.now, await loadSettings(tx)),
      });
      return { ok: true as const, id: row.id };
    });
  },
});

// =========================================================================== O-04 pricing

export const PricingBoardView = z.object({
  settings: z.record(z.string(), z.number()),
  version: z.number(),
  editable: z.array(z.string()),
  history: z.array(
    z.object({ version: z.number(), at: z.string(), by: z.string(), changes: z.string() }),
  ),
});

export const getPricingBoard = defineHandler({
  auth: OPS,
  input: EmptyInput,
  output: PricingBoardView,
  async run(ctx) {
    const s = await loadSettings(ctx.db);
    const row = await ctx.db.settings.findUniqueOrThrow({ where: { id: 1 } });
    const history = await ctx.db.settingsHistory.findMany({
      orderBy: { created_date: "desc" },
      take: 15,
    });
    const names = await ctx.db.profile.findMany({
      where: { id: { in: history.map((h) => h.changed_by ?? "") } },
      select: { id: true, full_name: true, email: true },
    });
    return {
      settings: Object.fromEntries(EDITABLE_SETTINGS.map((k) => [k, s[k]])),
      version: row.settings_version,
      editable: [...EDITABLE_SETTINGS],
      history: history.map((h) => {
        const n = names.find((x) => x.id === h.changed_by);
        return {
          version: h.settings_version,
          at: h.created_date.toISOString(),
          by: n?.full_name || n?.email || "System",
          changes: JSON.stringify(h.changes),
        };
      }),
    };
  },
});

/** O-04: validated Settings change with history (never the demo clock or demo switches). */
export const savePricingSettings = defineHandler({
  auth: OPS,
  input: z.object({ changes: z.record(z.string(), z.number()) }).strict(),
  output: z.object({ ok: z.literal(true), version: z.number() }),
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const patch = input.changes as Partial<Record<EditableSetting, number>>;
      const errors = validateSettingsPatch(s, patch);
      if (errors.length) throw new DomainError(400, "invalid_settings", errors.join(" "));
      const changed = Object.fromEntries(
        Object.entries(patch).filter(([k, v]) => s[k as EditableSetting] !== v),
      );
      if (!Object.keys(changed).length) throw new DomainError(400, "no_change", "Nothing changed.");
      const row = await tx.settings.update({
        where: { id: 1 },
        data: { ...changed, settings_version: { increment: 1 } },
      });
      const diff = Object.fromEntries(
        Object.entries(changed).map(([k, v]) => [k, { from: s[k as EditableSetting], to: v }]),
      );
      await tx.settingsHistory.create({
        data: {
          settings_version: row.settings_version,
          changed_by: ctx.actor.userId,
          changes: diff,
        },
      });
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Pricing settings changed (v${row.settings_version}): ${Object.keys(changed).join(", ")}.`,
        entity: "settings",
        entityId: "1",
        businessDate: businessDate(ctx.now, s),
      });
      return { ok: true as const, version: row.settings_version };
    });
  },
});

// =========================================================================== O-05 liquidity

export const LiquidityBoardView = z.object({
  threshold: z.number(),
  perModelCap: Money,
  models: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      tier: z.string(),
      score: z.number().nullable(),
      source: z.string().nullable(),
      daysToSell: z.number().nullable(),
      volatility: z.number().nullable(),
      launchWindow: z.boolean(),
      exposure: Money,
      stock: z.number(),
      icPaused: z.boolean(),
      trend: z.array(z.number()),
    }),
  ),
});

export const getLiquidityBoard = defineHandler({
  auth: OPS,
  input: EmptyInput,
  output: LiquidityBoardView,
  async run(ctx) {
    const s = await loadSettings(ctx.db);
    const models = await ctx.db.deviceModel.findMany({
      where: { active: true },
      include: { liquidity_scores: { orderBy: { calculated_at: "desc" }, take: 8 } },
      orderBy: { brand: "asc" },
    });
    const out = [];
    for (const m of models) {
      const owned = await ctx.db.device.aggregate({
        _sum: { acquisition_cost: true },
        _count: { _all: true },
        where: { device_model_id: m.id, status: { notIn: ["settled", "liquidated"] } },
      });
      const cur = m.liquidity_scores[0];
      out.push({
        id: m.id,
        name: deviceName(m),
        tier: m.liquidity_tier,
        score: cur?.score ?? null,
        source: cur?.source ?? null,
        daysToSell: cur?.days_to_sell ?? null,
        volatility: cur?.volatility ?? null,
        launchWindow: (cur?.launch_window ?? 0) === 1,
        exposure: owned._sum.acquisition_cost ?? 0,
        stock: owned._count._all,
        icPaused: m.ic_paused,
        trend: [...m.liquidity_scores].reverse().map((x) => x.score),
      });
    }
    return { threshold: s.liquidity_threshold, perModelCap: s.per_model_cap, models: out };
  },
});

export const setIcPaused = defineHandler({
  auth: OPS,
  input: z.object({ modelId: id, paused: z.boolean() }).strict(),
  output: z.object({ ok: z.literal(true), affectedOffers: z.number() }),
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const m = await tx.deviceModel.update({
        where: { id: input.modelId },
        data: { ic_paused: input.paused },
      });
      let affected = 0;
      if (input.paused) {
        // Live offers that still show Instant Cash are told it is withdrawn; acceptance re-checks anyway.
        const offers = await tx.offer.findMany({
          where: {
            status: "active",
            ic_eligible: true,
            submission: { device_model_id: m.id, status: "graded" },
          },
        });
        for (const o of offers) {
          await tx.offer.update({
            where: { id: o.id },
            data: {
              ic_eligible: false,
              ic_reason:
                "Instant Cash is paused for this model right now. The guaranteed price is still available.",
            },
          });
          await notify(
            tx,
            [
              {
                userId: o.seller_id,
                event: "ic_withdrawn",
                title: "Instant Cash is no longer available",
                body: "The guaranteed price is still available for your device.",
                link: `/seller/sell/${o.submission_id}/offer`,
              },
            ],
            ctx.env.appPublicUrl,
          );
          affected++;
        }
      }
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Instant Cash ${input.paused ? "paused" : "resumed"} for ${deviceName(m)}.`,
        entity: "device_model",
        entityId: m.id,
        businessDate: businessDate(ctx.now, s),
      });
      return { ok: true as const, affectedOffers: affected };
    });
  },
});

// =========================================================================== O-06 inventory

export const InventoryView = z.object({
  items: z.array(
    z.object({
      deviceId: z.string(),
      tag: z.string(),
      device: z.string(),
      grade: z.string(),
      status: z.string(),
      hub: z.string(),
      cost: Money,
      custodyAt: z.string(),
      daysHeld: z.number(),
      listing: z
        .object({
          id: z.string(),
          basePrice: Money,
          currentPrice: Money,
          floorPrice: Money,
          overridePrice: Money.nullable(),
          ladderStep: z.number(),
          daysListed: z.number(),
          warrantyMonths: z.number(),
          status: z.string(),
        })
        .nullable(),
    }),
  ),
});

export const getOpsInventory = defineHandler({
  auth: OPS,
  input: z.object({ status: z.string().max(30).optional() }).strict(),
  output: InventoryView,
  async run(ctx, input) {
    const s = await loadSettings(ctx.db);
    const day = businessDate(ctx.now, s);
    const devices = await ctx.db.device.findMany({
      where: {
        owner: "certibuy",
        ...(input.status
          ? { status: input.status as never }
          : { status: { notIn: ["settled", "liquidated"] } }),
      },
      include: {
        device_model: true,
        hub: true,
        listings: { orderBy: { created_date: "desc" }, take: 1 },
      },
      orderBy: { custody_at: "asc" },
      take: 300,
    });
    return {
      items: devices.map((d) => {
        const l = d.listings[0];
        return {
          deviceId: d.id,
          tag: d.tag_id,
          device: deviceName(d.device_model),
          grade: d.final_grade,
          status: d.status,
          hub: d.hub.name,
          cost: d.acquisition_cost,
          custodyAt: toIsoDate(d.custody_at),
          daysHeld: Math.max(
            0,
            Math.round((Date.parse(`${day}T00:00:00Z`) - d.custody_at.getTime()) / 86_400_000),
          ),
          listing: l
            ? {
                id: l.id,
                basePrice: l.base_price,
                currentPrice: l.current_price,
                floorPrice: l.floor_price,
                overridePrice: l.override_price,
                ladderStep: l.ladder_step,
                daysListed: daysListed(toIsoDate(l.listed_at), day, l.reserved_days),
                warrantyMonths: l.warranty_months,
                status: l.status,
              }
            : null,
        };
      }),
    };
  },
});

/** O-06: set or clear an override price (stops the ladder). Never below the floor. */
export const setListingOverride = defineHandler({
  auth: OPS,
  input: z
    .object({
      listingId: id,
      price: Money.min(1).nullable(),
      reason: z.string().trim().min(3).max(200),
    })
    .strict(),
  output: ok,
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const l = await tx.listing.findUniqueOrThrow({
        where: { id: input.listingId },
        include: { device: { include: { device_model: true } } },
      });
      if (!["active", "review"].includes(l.status))
        throw new DomainError(409, "not_listed", "Only a listed device can be repriced.");
      if (input.price !== null && input.price < l.floor_price)
        throw new DomainError(
          400,
          "below_floor",
          `The price can't go below the floor of ${formatInr(l.floor_price)}.`,
        );
      await tx.listing.update({
        where: { id: l.id },
        data: {
          override_price: input.price,
          override_by: input.price === null ? null : ctx.actor.userId,
          override_at: input.price === null ? null : ctx.now,
          ...(l.status === "review" ? { status: "active" } : {}),
        },
      });
      if (l.status === "review")
        await tx.device.update({ where: { id: l.device_id }, data: { status: "listed" } });
      await logActivity(tx, {
        actor: ctx.actor,
        text:
          input.price === null
            ? `Override cleared on ${deviceName(l.device.device_model)} (${input.reason}).`
            : `${deviceName(l.device.device_model)} repriced to ${formatInr(input.price)} (${input.reason}).`,
        entity: "listing",
        entityId: l.id,
        businessDate: businessDate(ctx.now, s),
      });
      return { ok: true as const };
    });
  },
});

/** O-06 / F9: refurbished (or reviewed) device back on the shelf; grade D lists with no warranty. */
export const markRefurbishedAndList = defineHandler({
  auth: OPS,
  input: z
    .object({
      deviceId: id,
      partsReplaced: z.array(z.string().trim().min(1).max(40)).max(10),
      resetLadder: z.boolean(),
    })
    .strict(),
  output: z.object({
    ok: z.literal(true),
    listingId: z.string(),
    basePrice: Money,
    warrantyMonths: z.number(),
  }),
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const day = businessDate(ctx.now, s);
      const d = await tx.device.findUniqueOrThrow({
        where: { id: input.deviceId },
        include: { device_model: true, listings: { orderBy: { created_date: "desc" }, take: 1 } },
      });
      if (!["in_refurbishment", "day45_review"].includes(d.status))
        throw new DomainError(
          409,
          "not_ready",
          "Only devices in refurbishment or review can be listed this way.",
        );
      const live =
        d.listings[0] && ["active", "review", "reserved"].includes(d.listings[0].status)
          ? d.listings[0]
          : null;
      let listingId: string;
      let basePrice: number;
      let warrantyMonths: number;
      if (live && !input.resetLadder) {
        await tx.listing.update({ where: { id: live.id }, data: { status: "active" } });
        ({ id: listingId, base_price: basePrice, warranty_months: warrantyMonths } = live);
      } else {
        if (live) await tx.listing.update({ where: { id: live.id }, data: { status: "inactive" } });
        const plan = planListing("refurbished", d.final_grade, d.device_model, s);
        if (!plan.listingCreated)
          throw new DomainError(409, "cannot_list", "This device can't be listed.");
        const created = await tx.listing.create({
          data: {
            device_id: d.id,
            base_price: plan.basePrice,
            current_price: plan.basePrice,
            floor_price: plan.floorPrice,
            listed_at: fromIsoDate(day),
            warranty_months: plan.warrantyMonths,
          },
        });
        listingId = created.id;
        basePrice = created.base_price;
        warrantyMonths = created.warranty_months;
      }
      await tx.device.update({
        where: { id: d.id },
        data: { status: "listed", parts_replaced: { push: input.partsReplaced } },
      });
      await logActivity(tx, {
        actor: ctx.actor,
        text: `${deviceName(d.device_model)} (${d.tag_id}) listed at ${formatInr(basePrice)}${warrantyMonths === 0 ? " with no warranty" : ""}${input.partsReplaced.length ? `; parts: ${input.partsReplaced.join(", ")}` : ""}.`,
        entity: "device",
        entityId: d.id,
        businessDate: day,
      });
      return { ok: true as const, listingId, basePrice, warrantyMonths };
    });
  },
});

/** O-06 / F10: B2B liquidation at the floor price — a one-click ops decision, never automatic. */
export const liquidateDevice = defineHandler({
  auth: OPS,
  input: z.object({ deviceId: id }).strict(),
  output: z.object({ ok: z.literal(true), proceeds: Money }),
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const d = await tx.device.findUniqueOrThrow({
        where: { id: input.deviceId },
        include: { device_model: true, listings: { orderBy: { created_date: "desc" }, take: 1 } },
      });
      if (!["listed", "day45_review", "in_refurbishment"].includes(d.status))
        throw new DomainError(409, "not_liquidatable", "This device can't be liquidated now.");
      const listing = d.listings[0];
      if (listing && listing.status === "reserved")
        throw new DomainError(409, "reserved", "A buyer has reserved this device.");
      const proceeds = listing?.floor_price ?? d.device_model.b2b_floor_price;
      await tx.device.update({ where: { id: d.id }, data: { status: "liquidated" } });
      if (listing)
        await tx.listing.update({ where: { id: listing.id }, data: { status: "liquidated" } });
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Liquidated ${deviceName(d.device_model)} (${d.tag_id}) to B2B at ${formatInr(proceeds)}.`,
        entity: "device",
        entityId: d.id,
        businessDate: businessDate(ctx.now, s),
      });
      return { ok: true as const, proceeds };
    });
  },
});

// =========================================================================== O-07 exceptions

export const ExceptionQueueView = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      title: z.string(),
      detail: z.string().nullable(),
      status: z.string(),
      resolution: z.string().nullable(),
      relatedEntity: z.string().nullable(),
      relatedId: z.string().nullable(),
      openedAt: z.string(),
      ageDays: z.number(),
      action: z.object({ label: z.string(), href: z.string() }).nullable(),
      mismatchFeePending: z.boolean(),
    }),
  ),
});

export const getExceptionQueue = defineHandler({
  auth: OPS,
  input: z
    .object({
      status: z.enum(["open", "resolved"]).optional(),
      type: z.enum(["return", "failed_inspection", "grade_dispute", "payment_hold"]).optional(),
    })
    .strict(),
  output: ExceptionQueueView,
  async run(ctx, input) {
    const cases = await ctx.db.exceptionCase.findMany({
      where: { status: input.status ?? "open", ...(input.type ? { type: input.type } : {}) },
      orderBy: { created_date: "asc" },
      take: 200,
    });
    const subIds = cases
      .filter((c) => c.related_entity === "submission" && c.related_id)
      .map((c) => c.related_id as string);
    const pendingFees = new Set(
      (
        await ctx.db.submission.findMany({
          where: { id: { in: subIds }, mismatch_fee_status: "pending" },
          select: { id: true },
        })
      ).map((x) => x.id),
    );
    return {
      items: cases.map((c) => ({
        id: c.id,
        type: c.type,
        title: c.title,
        detail: c.detail,
        status: c.status,
        resolution: c.resolution,
        relatedEntity: c.related_entity,
        relatedId: c.related_id,
        openedAt: c.created_date.toISOString(),
        ageDays: Math.floor((ctx.now.getTime() - c.created_date.getTime()) / 86_400_000),
        action:
          c.type === "return"
            ? { label: "Resolve the return", href: "/ops/returns" }
            : c.type === "payment_hold"
              ? { label: "Retry the payout", href: "/ops/jobs" }
              : null,
        mismatchFeePending: Boolean(c.related_id && pendingFees.has(c.related_id)),
      })),
    };
  },
});

/** O-07: close a non-money case with a resolution line (money cases resolve through their flows). */
export const resolveExceptionCase = defineHandler({
  auth: OPS,
  input: z.object({ caseId: id, resolution: z.string().trim().min(5).max(500) }).strict(),
  output: ok,
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const c = await tx.exceptionCase.findUniqueOrThrow({ where: { id: input.caseId } });
      if (c.status === "resolved")
        throw new DomainError(409, "already_resolved", "This case is already resolved.");
      if (c.type === "return" || c.type === "payment_hold")
        throw new DomainError(
          409,
          "money_case",
          "Resolve this case from its return or payout so the ledgers stay correct.",
        );
      await tx.exceptionCase.update({
        where: { id: c.id },
        data: { status: "resolved", resolution: input.resolution },
      });
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Exception resolved: ${c.title} — ${input.resolution}`,
        entity: c.related_entity ?? "exception",
        entityId: c.related_id ?? c.id,
        businessDate: businessDate(ctx.now, s),
      });
      return { ok: true as const };
    });
  },
});

/** O-07: record a mismatch fee collected after the visit (writes the fee payout row once). */
export const collectMismatchFee = defineHandler({
  auth: OPS,
  input: z.object({ submissionId: id }).strict(),
  output: ok,
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const moved = await tx.submission.updateMany({
        where: { id: input.submissionId, mismatch_fee_status: "pending" },
        data: { mismatch_fee_status: "paid" },
      });
      if (!moved.count)
        throw new DomainError(409, "no_fee_due", "There's no mismatch fee due on this deal.");
      const sub = await tx.submission.findUniqueOrThrow({ where: { id: input.submissionId } });
      await tx.payout.create({
        data: {
          seller_id: sub.seller_id,
          submission_id: sub.id,
          type: "mismatch_fee",
          amount: s.mismatch_fee,
          trigger: "inspection_mismatch",
          status: "paid",
          paid_at: ctx.now,
        },
      });
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Mismatch fee ${formatInr(s.mismatch_fee)} collected.`,
        entity: "submission",
        entityId: sub.id,
        businessDate: businessDate(ctx.now, s),
      });
      return { ok: true as const };
    });
  },
});

/** O-07 grade dispute in the seller's favour: waive a pending mismatch fee and restore trust. */
export const upholdGrade = defineHandler({
  auth: OPS,
  input: z.object({ caseId: id, note: z.string().trim().min(5).max(300) }).strict(),
  output: ok,
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const c = await tx.exceptionCase.findUniqueOrThrow({ where: { id: input.caseId } });
      if (c.status !== "open" || c.related_entity !== "submission" || !c.related_id)
        throw new DomainError(409, "not_disputable", "This case can't be resolved this way.");
      const sub = await tx.submission.findUniqueOrThrow({ where: { id: c.related_id } });
      if (sub.mismatch_fee_status === "pending")
        await tx.submission.update({
          where: { id: sub.id },
          data: { mismatch_fee_status: "waived" },
        });
      await tx.profile.update({
        where: { id: sub.seller_id },
        data: { trust_score: { increment: 10 } },
      });
      await tx.exceptionCase.update({
        where: { id: c.id },
        data: { status: "resolved", resolution: `Resolved in the seller's favour: ${input.note}` },
      });
      await notify(
        tx,
        [
          {
            userId: sub.seller_id,
            event: "mismatch_fee",
            title: "Your grade dispute was resolved",
            body: "We reviewed the inspection and resolved it in your favour.",
            link: `/seller/deals/${sub.id}`,
          },
        ],
        ctx.env.appPublicUrl,
      );
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Grade dispute resolved for the seller: ${input.note}`,
        entity: "submission",
        entityId: sub.id,
        businessDate: businessDate(ctx.now, s),
      });
      return { ok: true as const };
    });
  },
});

// =========================================================================== O-08 hubs

const HubInput = z
  .object({
    id: id.optional(),
    name: z.string().trim().min(3).max(80),
    type: z.enum(["flagship", "partner"]),
    address: z.string().trim().min(5).max(200),
    city: z.string().trim().min(2).max(60),
    pincode: z.string().regex(/^\d{6}$/, "Enter a 6-digit pincode."),
    slotTimes: z
      .array(z.string().regex(/^\d{2}:\d{2}$/))
      .min(1)
      .max(16),
    dailyCapacity: z.number().int().min(1).max(500),
    distanceKm: z.number().min(0).max(1000).nullable(),
    active: z.boolean(),
  })
  .strict();

export const HubsBoardView = z.object({
  hubs: z.array(
    HubInput.extend({ id: z.string(), technicians: z.number(), bookingsToday: z.number() }),
  ),
});

export const getHubsBoard = defineHandler({
  auth: OPS,
  input: EmptyInput,
  output: HubsBoardView,
  async run(ctx) {
    const s = await loadSettings(ctx.db);
    const day = businessDate(ctx.now, s);
    const hubs = await ctx.db.hub.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { technicians: true } } },
    });
    const today = await ctx.db.booking.groupBy({
      by: ["hub_id"],
      where: { date: fromIsoDate(day), status: { in: ["booked", "completed"] } },
      _count: { _all: true },
    });
    return {
      hubs: hubs.map((h) => ({
        id: h.id,
        name: h.name,
        type: h.type,
        address: h.address,
        city: h.city,
        pincode: h.pincode,
        slotTimes: h.slot_times,
        dailyCapacity: h.daily_capacity,
        distanceKm: h.distance_km,
        active: h.active,
        technicians: h._count.technicians,
        bookingsToday: today.find((t) => t.hub_id === h.id)?._count._all ?? 0,
      })),
    };
  },
});

export const saveHub = defineHandler({
  auth: OPS,
  input: HubInput,
  output: z.object({ ok: z.literal(true), id: z.string() }),
  async run(ctx, i) {
    const slots = [...new Set(i.slotTimes)].sort();
    const data = {
      name: i.name,
      type: i.type,
      address: i.address,
      city: i.city,
      pincode: i.pincode,
      slot_times: slots,
      daily_capacity: i.dailyCapacity,
      distance_km: i.distanceKm,
      active: i.active,
    };
    return ctx.db.$transaction(async (tx) => {
      const h = i.id
        ? await tx.hub.update({ where: { id: i.id }, data })
        : await tx.hub.create({ data });
      await logActivity(tx, {
        actor: ctx.actor,
        text: `${i.id ? "Updated" : "Added"} hub ${h.name}${h.active ? "" : " (inactive)"}.`,
        entity: "hub",
        entityId: h.id,
        businessDate: businessDate(ctx.now, await loadSettings(tx)),
      });
      return { ok: true as const, id: h.id };
    });
  },
});

// =========================================================================== O-09 users and invitations

export const UsersBoardView = z.object({
  canManage: z.boolean(),
  hubs: z.array(z.object({ id: z.string(), name: z.string() })),
  users: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().nullable(),
      appRole: z.string(),
      hubId: z.string().nullable(),
      isPlatformAdmin: z.boolean(),
      trustScore: z.number(),
      returnCount: z.number(),
      accountFlagged: z.boolean(),
      joined: z.string(),
    }),
  ),
  invitations: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      appRole: z.string(),
      status: z.string(),
      expiresAt: z.string(),
    }),
  ),
});

export const getUsersBoard = defineHandler({
  auth: OPS,
  input: z.object({ q: z.string().trim().max(60).optional() }).strict(),
  output: UsersBoardView,
  async run(ctx, input) {
    const q = input.q;
    const [users, hubs, invitations] = await Promise.all([
      ctx.db.profile.findMany({
        where: q
          ? {
              OR: [
                { email: { contains: q, mode: "insensitive" } },
                { full_name: { contains: q, mode: "insensitive" } },
              ],
            }
          : {},
        orderBy: { created_date: "desc" },
        take: 200,
      }),
      ctx.db.hub.findMany({ where: { active: true }, select: { id: true, name: true } }),
      ctx.db.invitation.findMany({ orderBy: { created_date: "desc" }, take: 20 }),
    ]);
    return {
      canManage: ctx.actor.isPlatformAdmin,
      hubs,
      users: users.map((u) => ({
        id: u.id,
        name: u.full_name || u.email || "—",
        email: u.email,
        appRole: u.app_role,
        hubId: u.hub_id,
        isPlatformAdmin: u.is_platform_admin,
        trustScore: u.trust_score,
        returnCount: u.return_count,
        accountFlagged: u.account_flagged,
        joined: u.created_date.toISOString(),
      })),
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        appRole: i.app_role,
        status: i.status,
        expiresAt: i.expires_at.toISOString(),
      })),
    };
  },
});

/** O-09: role, hub, trust score and flag — platform admin only (roles.md.txt §2). */
export const saveUserAccess = defineHandler({
  auth: OPS,
  input: z
    .object({
      userId: id,
      appRole: z.enum(["customer", "technician", "ops"]),
      hubId: id.nullable(),
      trustScore: z.number().int().min(0).max(100),
      accountFlagged: z.boolean(),
    })
    .strict(),
  output: ok,
  async run(ctx, input) {
    assertPlatformAdmin(ctx.actor);
    if (input.appRole === "technician" && !input.hubId)
      throw new DomainError(400, "hub_required", "Choose a hub for a technician.");
    return ctx.db.$transaction(async (tx) => {
      const before = await tx.profile.findUniqueOrThrow({ where: { id: input.userId } });
      if (before.id === ctx.actor.userId && input.appRole !== before.app_role)
        throw new DomainError(409, "self_role", "You can't change your own role.");
      await tx.profile.update({
        where: { id: input.userId },
        data: {
          app_role: input.appRole,
          hub_id: input.appRole === "technician" ? input.hubId : null,
          trust_score: input.trustScore,
          account_flagged: input.accountFlagged,
        },
      });
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Access changed for ${before.email ?? before.id}: ${before.app_role} → ${input.appRole}${input.hubId ? ` @ ${input.hubId}` : ""}${input.accountFlagged ? ", flagged" : ""}.`,
        entity: "profile",
        entityId: before.id,
        businessDate: businessDate(ctx.now, await loadSettings(tx)),
      });
      return { ok: true as const };
    });
  },
});

/** O-09 / F12: invite staff — returns a link to copy (no email is sent in the capstone). */
export const inviteStaff = defineHandler({
  auth: OPS,
  input: z
    .object({
      email: z.string().trim().toLowerCase().email(),
      appRole: z.enum(["technician", "ops"]),
      hubId: id.nullable(),
    })
    .strict(),
  output: z.object({ ok: z.literal(true), link: z.string(), existingUser: z.boolean() }),
  async run(ctx, input) {
    assertPlatformAdmin(ctx.actor);
    if (input.appRole === "technician" && !input.hubId)
      throw new DomainError(400, "hub_required", "Choose a hub for a technician.");
    if (input.hubId && !(await ctx.db.hub.findUnique({ where: { id: input.hubId } })))
      throw new DomainError(404, "hub_missing", "That hub doesn't exist.");
    const { link, existingUser } = await ctx.authAdmin.inviteLink(
      input.email,
      `${ctx.env.appPublicUrl}/auth/callback?next=/mfa`,
    );
    await ctx.db.$transaction(async (tx) => {
      await tx.invitation.updateMany({
        where: { email: input.email, status: "pending" },
        data: { status: "revoked" },
      });
      await tx.invitation.create({
        data: {
          email: input.email,
          app_role: input.appRole,
          hub_id: input.appRole === "technician" ? input.hubId : null,
          invited_by: ctx.actor.userId,
          expires_at: new Date(ctx.now.getTime() + 7 * 86_400_000),
        },
      });
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Invited ${input.email} as ${input.appRole}.`,
        entity: "invitation",
        entityId: input.email,
        businessDate: businessDate(ctx.now, await loadSettings(tx)),
      });
    });
    return { ok: true as const, link, existingUser };
  },
});

/** Applied when an invited person signs in: their invited role and hub, once (roles.md.txt §7). */
export async function acceptPendingInvitation(
  tx: Tx,
  profile: { id: string; email: string | null; app_role: string },
  now: Date,
): Promise<boolean> {
  if (!profile.email || profile.app_role !== "customer") return false;
  const inv = await tx.invitation.findFirst({
    where: { email: profile.email.toLowerCase(), status: "pending", expires_at: { gt: now } },
    orderBy: { created_date: "desc" },
  });
  if (!inv) return false;
  await tx.profile.update({
    where: { id: profile.id },
    data: { app_role: inv.app_role, hub_id: inv.hub_id },
  });
  await tx.invitation.update({
    where: { id: inv.id },
    data: { status: "accepted", accepted_by: profile.id, accepted_at: now },
  });
  await tx.activityLog.create({
    data: {
      actor_id: profile.id,
      actor_name: profile.email,
      text: `Accepted the invitation as ${inv.app_role}.`,
      entity: "profile",
      entity_id: profile.id,
      business_date: fromIsoDate(now.toISOString().slice(0, 10)),
    },
  });
  return true;
}

// =========================================================================== O-10 metrics

export const MetricsView = z.object({
  weeks: z.array(z.string()),
  metrics: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      unit: z.string(),
      target: z.number(),
      direction: z.enum(["atMost", "atLeast"]),
      current: z.number().nullable(),
      periods: z.array(z.number().nullable()),
      purpose: z.string(),
    }),
  ),
});

export const getMetrics = defineHandler({
  auth: OPS,
  input: EmptyInput,
  output: MetricsView,
  async run(ctx) {
    const s = await loadSettings(ctx.db);
    const day = businessDate(ctx.now, s);
    const W = 8;
    const weeks = weekStarts(day, W);
    const since = new Date(Date.parse(`${weeks[0]}T00:00:00Z`));
    const wk = (d: Date) => weekIndex(d.toISOString().slice(0, 10), day, W);
    const [reports, offers, devices, sold, listings, balances, returns, delivered] =
      await Promise.all([
        ctx.db.inspectionReport.findMany({
          where: { type: "intake", verdict: { not: null }, sealed_at: { gte: since } },
          select: { verdict: true, sealed_at: true },
        }),
        ctx.db.offer.findMany({
          where: { created_date: { gte: since } },
          select: { status: true, created_date: true },
        }),
        ctx.db.device.findMany({
          where: { created_date: { gte: since } },
          select: { payout_option: true, created_date: true },
        }),
        ctx.db.order.findMany({
          where: { status: { in: ["delivered", "settled"] }, paid_at: { gte: since } },
          include: { listing: true },
        }),
        ctx.db.listing.findMany({
          where: { created_date: { gte: since } },
          include: {
            orders: { where: { status: { notIn: ["cancelled"] } }, select: { paid_at: true } },
          },
        }),
        ctx.db.payout.findMany({
          where: { type: "balance", trigger: "day_21_unsold", updated_date: { gte: since } },
          select: { updated_date: true },
        }),
        ctx.db.returnRequest.findMany({
          where: { reason: "not_as_graded", created_date: { gte: since } },
          select: { created_date: true },
        }),
        ctx.db.order.findMany({
          where: { delivered_at: { gte: since } },
          select: { delivered_at: true },
        }),
      ]);
    const series = (fn: (i: number) => number | null) => Array.from({ length: W }, (_, i) => fn(i));
    const count =
      <T>(rows: T[], when: (r: T) => Date | null, pred: (r: T) => boolean = () => true) =>
      (i: number) =>
        rows.filter((r) => {
          const d = when(r);
          return d && wk(d) === i && pred(r);
        }).length;
    const ageing = await ctx.db.listing.count({ where: { status: "review" } });
    const defs = [
      {
        key: "mismatch",
        label: "Grade-mismatch rate",
        unit: "%",
        target: 15,
        direction: "atMost" as const,
        purpose: "Counter grades below the quoted range.",
        periods: series((i) =>
          percent(
            count(
              reports,
              (r) => r.sealed_at,
              (r) => r.verdict !== "inside",
            )(i),
            count(reports, (r) => r.sealed_at)(i),
          ),
        ),
      },
      {
        key: "acceptance",
        label: "Offer-acceptance rate",
        unit: "%",
        target: 60,
        direction: "atLeast" as const,
        purpose: "Offers sellers accepted.",
        periods: series((i) =>
          percent(
            count(
              offers,
              (o) => o.created_date,
              (o) => o.status === "accepted",
            )(i),
            count(offers, (o) => o.created_date)(i),
          ),
        ),
      },
      {
        key: "instant_cash",
        label: "Instant Cash share",
        unit: "%",
        target: 40,
        direction: "atLeast" as const,
        purpose: "Devices bought outright.",
        periods: series((i) =>
          percent(
            count(
              devices,
              (d) => d.created_date,
              (d) => d.payout_option === "instant_cash",
            )(i),
            count(devices, (d) => d.created_date)(i),
          ),
        ),
      },
      {
        key: "days_to_sell",
        label: "Median days to sell",
        unit: "days",
        target: 21,
        direction: "atMost" as const,
        purpose: "Listing to sale.",
        periods: series((i) =>
          median(
            sold
              .filter((o) => o.paid_at && wk(o.paid_at) === i)
              .map((o) =>
                Math.max(
                  0,
                  Math.round(
                    ((o.paid_at as Date).getTime() - o.listing.listed_at.getTime()) / 86_400_000,
                  ),
                ),
              ),
          ),
        ),
      },
      {
        key: "sell_through",
        label: "30-day sell-through",
        unit: "%",
        target: 50,
        direction: "atLeast" as const,
        purpose: "Listings sold within 30 days.",
        periods: series((i) => {
          const set = listings.filter((l) => wk(l.created_date) === i);
          return percent(
            set.filter((l) =>
              l.orders.some(
                (o) =>
                  o.paid_at && o.paid_at.getTime() - l.created_date.getTime() <= 30 * 86_400_000,
              ),
            ).length,
            set.length,
          );
        }),
      },
      {
        key: "day21_unsold",
        label: "Devices reaching day 21 unsold",
        unit: "devices",
        target: 0,
        direction: "atMost" as const,
        purpose: "Sell For More balances paid before a sale.",
        periods: series(count(balances, (b) => b.updated_date)),
      },
      {
        key: "ageing",
        label: `Inventory beyond day ${s.review_day}`,
        unit: "devices",
        target: 0,
        direction: "atMost" as const,
        purpose: "Units waiting for review or liquidation.",
        periods: series((i) => (i === W - 1 ? ageing : null)),
      },
      {
        key: "returns",
        label: "Not-as-graded return rate",
        unit: "%",
        target: 3,
        direction: "atMost" as const,
        purpose: "Returns because the grade was wrong.",
        periods: series((i) =>
          percent(
            count(returns, (r) => r.created_date)(i),
            count(delivered, (o) => o.delivered_at)(i),
          ),
        ),
      },
      {
        key: "cost_per_acquisition",
        label: "Cost per successful acquisition",
        unit: "₹",
        target: 500,
        direction: "atMost" as const,
        purpose: "Hub cost per accepted device.",
        periods: series((i) => {
          const n = count(devices, (d) => d.created_date)(i);
          const insp = count(reports, (r) => r.sealed_at)(i);
          return n ? Math.round((insp * s.hub_cost) / n) : null;
        }),
      },
    ];
    return {
      weeks,
      metrics: defs.map((m) => ({
        ...m,
        current: [...m.periods].reverse().find((v) => v !== null) ?? null,
      })),
    };
  },
});

// =========================================================================== finance and escrow

export const FinanceView = z.object({
  escrow: z.object({ held: Money, released: Money, refunded: Money, heldOrders: z.number() }),
  payouts: z.object({
    paid: Money,
    pending: Money,
    due: Money,
    onHold: Money,
    mismatchFees: Money,
  }),
  liquidationProceeds: Money,
  anomalies: z.array(z.object({ orderNo: z.string(), issue: z.string() })),
  ledger: z.array(
    z.object({
      at: z.string(),
      kind: z.string(),
      type: z.string(),
      amount: Money,
      reference: z.string(),
      note: z.string().nullable(),
    }),
  ),
});

export const getFinanceBoard = defineHandler({
  auth: OPS,
  input: z.object({ kind: z.enum(["escrow", "payout"]).optional() }).strict(),
  output: FinanceView,
  async run(ctx, input) {
    const [escrowSums, payoutSums, held, liquidated, escrowRows, payoutRows, orders] =
      await Promise.all([
        ctx.db.escrowTransaction.groupBy({ by: ["type"], _sum: { amount: true } }),
        ctx.db.payout.groupBy({ by: ["type", "status"], _sum: { amount: true } }),
        ctx.db.order.aggregate({
          _sum: { total: true },
          _count: { _all: true },
          where: { escrow_status: { in: ["hold", "held_replacement"] } },
        }),
        ctx.db.listing.aggregate({ _sum: { floor_price: true }, where: { status: "liquidated" } }),
        input.kind === "payout"
          ? []
          : ctx.db.escrowTransaction.findMany({ orderBy: { created_date: "desc" }, take: 60 }),
        input.kind === "escrow"
          ? []
          : ctx.db.payout.findMany({ orderBy: { updated_date: "desc" }, take: 60 }),
        ctx.db.order.findMany({
          where: { escrow_transactions: { some: {} } },
          include: { escrow_transactions: true },
        }),
      ]);
    const esc = (t: string) => escrowSums.find((x) => x.type === t)?._sum.amount ?? 0;
    const pay = (pred: (r: (typeof payoutSums)[number]) => boolean) =>
      payoutSums.filter(pred).reduce((a, r) => a + (r._sum.amount ?? 0), 0);
    // Reconciliation: hold = total; closing movements never exceed the hold; at most one release.
    const anomalies = orders.flatMap((o) => {
      const sum = (t: string) =>
        o.escrow_transactions.filter((e) => e.type === t).reduce((a, e) => a + e.amount, 0);
      const issues = [];
      if (sum("hold") !== o.total)
        issues.push(`escrow hold ${formatInr(sum("hold"))} ≠ order total ${formatInr(o.total)}`);
      if (sum("release") + sum("refund_full") + sum("refund_partial") > sum("hold"))
        issues.push("closing movements exceed the hold");
      if (o.escrow_transactions.filter((e) => e.type === "release").length > 1)
        issues.push("more than one release");
      return issues.map((issue) => ({ orderNo: orderNo(o.id), issue }));
    });
    const ledger = [
      ...escrowRows.map((e) => ({
        at: e.created_date.toISOString(),
        kind: "escrow",
        type: e.type,
        amount: e.amount,
        reference: orderNo(e.order_id),
        note: e.note,
      })),
      ...payoutRows.map((p) => ({
        at: p.updated_date.toISOString(),
        kind: "payout",
        type: `${p.type} · ${p.status}`,
        amount: p.amount,
        reference: p.id.slice(-8).toUpperCase(),
        note: p.failure_reason,
      })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 80);
    return {
      escrow: {
        held: held._sum.total ?? 0,
        released: esc("release"),
        refunded: esc("refund_full") + esc("refund_partial"),
        heldOrders: held._count._all,
      },
      payouts: {
        paid: pay((r) => r.status === "paid" && r.type !== "mismatch_fee"),
        pending: pay(
          (r) => (r.status === "pending" || r.status === "approved") && r.type !== "mismatch_fee",
        ),
        due: pay((r) => r.status === "due"),
        onHold: pay((r) => r.status === "failed"),
        mismatchFees: pay((r) => r.type === "mismatch_fee" && r.status === "paid"),
      },
      liquidationProceeds: liquidated._sum.floor_price ?? 0,
      anomalies,
      ledger,
    };
  },
});

// =========================================================================== O-14 audit

export const AuditView = z.object({
  page: z.number(),
  hasMore: z.boolean(),
  entries: z.array(
    z.object({
      at: z.string(),
      businessDate: z.string(),
      actor: z.string(),
      entity: z.string().nullable(),
      entityId: z.string().nullable(),
      text: z.string(),
    }),
  ),
});

export const getAuditLog = defineHandler({
  auth: OPS,
  input: z
    .object({
      q: z.string().trim().max(80).optional(),
      entity: z.string().trim().max(30).optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
      page: z.coerce.number().int().min(1).max(500).optional(),
    })
    .strict(),
  output: AuditView,
  async run(ctx, input) {
    const page = input.page ?? 1;
    const size = 50;
    const rows = await ctx.db.activityLog.findMany({
      where: {
        ...(input.q
          ? {
              OR: [
                { text: { contains: input.q, mode: "insensitive" } },
                { actor_name: { contains: input.q, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(input.entity ? { entity: input.entity } : {}),
        ...(input.from || input.to
          ? {
              business_date: {
                ...(input.from ? { gte: fromIsoDate(input.from) } : {}),
                ...(input.to ? { lte: fromIsoDate(input.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { created_date: "desc" },
      skip: (page - 1) * size,
      take: size + 1,
    });
    return {
      page,
      hasMore: rows.length > size,
      entries: rows.slice(0, size).map((r) => ({
        at: r.created_date.toISOString(),
        businessDate: toIsoDate(r.business_date),
        actor: r.actor_name,
        entity: r.entity,
        entityId: r.entity_id,
        text: r.text,
      })),
    };
  },
});

// =========================================================================== X-05 / O-13 support

const SupportRow = z.object({
  id: z.string(),
  topic: z.string(),
  relatedId: z.string().nullable(),
  message: z.string(),
  status: z.string(),
  reply: z.string().nullable(),
  repliedAt: z.string().nullable(),
  createdAt: z.string(),
  customer: z.string().optional(),
});

export const SupportInboxView = z.object({ items: z.array(SupportRow) });
export const MySupportView = z.object({
  items: z.array(SupportRow),
  targets: z.array(z.object({ id: z.string(), label: z.string() })),
});

export const submitSupportRequest = defineHandler({
  auth: CUSTOMER,
  input: z
    .object({
      topic: z.enum(["selling_device", "order_delivery", "return_refund", "payments", "other"]),
      relatedId: id.optional(),
      message: z
        .string()
        .trim()
        .min(10, "Tell us a little more (at least 10 characters).")
        .max(1000),
    })
    .strict(),
  output: z.object({ ok: z.literal(true), requestId: z.string() }),
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      // Rate sanity (F18): at most 5 open requests per customer.
      if (
        (await tx.supportRequest.count({
          where: { customer_id: ctx.actor.userId, status: "open" },
        })) >= 5
      ) {
        throw new DomainError(
          409,
          "too_many_open",
          "You already have 5 open requests. We'll reply to those first.",
        );
      }
      const r = await tx.supportRequest.create({
        data: {
          customer_id: ctx.actor.userId,
          topic: input.topic,
          related_id: input.relatedId ?? null,
          message: input.message,
        },
      });
      const care = await tx.profile.findMany({
        where: { OR: [{ app_role: "ops" }, { is_platform_admin: true }] },
        select: { id: true },
      });
      await notify(
        tx,
        [
          {
            userId: ctx.actor.userId,
            event: "support_received",
            title: "We've got your message",
            body: "Customer care replies within one working day.",
            link: "/help",
          },
          ...care.map((c) => ({
            userId: c.id,
            event: "support_request",
            title: "New customer care request",
            body: input.message.slice(0, 120),
            link: "/ops/support",
          })),
        ],
        ctx.env.appPublicUrl,
      );
      return { ok: true as const, requestId: r.id };
    });
  },
});

export const getMySupport = defineHandler({
  auth: CUSTOMER,
  input: EmptyInput,
  output: MySupportView,
  async run(ctx) {
    const [items, subs, orders] = await Promise.all([
      ctx.db.supportRequest.findMany({
        where: { customer_id: ctx.actor.userId },
        orderBy: { created_date: "desc" },
        take: 30,
      }),
      ctx.db.submission.findMany({
        where: { seller_id: ctx.actor.userId },
        include: { device_model: true },
        orderBy: { created_date: "desc" },
        take: 20,
      }),
      ctx.db.order.findMany({
        where: { buyer_id: ctx.actor.userId },
        include: { device: { include: { device_model: true } } },
        orderBy: { created_date: "desc" },
        take: 20,
      }),
    ]);
    return {
      items: items.map((r) => ({
        id: r.id,
        topic: r.topic,
        relatedId: r.related_id,
        message: r.message,
        status: r.status,
        reply: r.reply,
        repliedAt: r.replied_at?.toISOString() ?? null,
        createdAt: r.created_date.toISOString(),
      })),
      targets: [
        ...subs.map((sb) => ({ id: sb.id, label: `Selling: ${deviceName(sb.device_model)}` })),
        ...orders.map((o) => ({
          id: o.id,
          label: `Order ${orderNo(o.id)}: ${deviceName(o.device.device_model)}`,
        })),
      ],
    };
  },
});

export const getSupportInbox = defineHandler({
  auth: OPS,
  input: z.object({ status: z.enum(["open", "resolved"]).optional() }).strict(),
  output: SupportInboxView,
  async run(ctx, input) {
    const items = await ctx.db.supportRequest.findMany({
      where: { status: input.status ?? "open" },
      include: { customer: { select: { full_name: true, email: true } } },
      orderBy: { created_date: "asc" },
      take: 200,
    });
    return {
      items: items.map((r) => ({
        id: r.id,
        topic: r.topic,
        relatedId: r.related_id,
        message: r.message,
        status: r.status,
        reply: r.reply,
        repliedAt: r.replied_at?.toISOString() ?? null,
        createdAt: r.created_date.toISOString(),
        customer: r.customer.full_name || r.customer.email || "Customer",
      })),
    };
  },
});

export const replySupportRequest = defineHandler({
  auth: OPS,
  input: z
    .object({ requestId: id, reply: z.string().trim().min(5).max(1000), resolve: z.boolean() })
    .strict(),
  output: ok,
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const r = await tx.supportRequest.findUniqueOrThrow({ where: { id: input.requestId } });
      await tx.supportRequest.update({
        where: { id: r.id },
        data: {
          reply: input.reply,
          replied_by: ctx.actor.userId,
          replied_at: ctx.now,
          ...(input.resolve
            ? { status: "resolved", resolved_by: ctx.actor.userId, resolved_at: ctx.now }
            : {}),
        },
      });
      await notify(
        tx,
        [
          {
            userId: r.customer_id,
            event: "support_reply",
            title: "Customer care replied",
            body: input.reply.slice(0, 160),
            link: "/help",
          },
        ],
        ctx.env.appPublicUrl,
      );
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Replied to a support request${input.resolve ? " and resolved it" : ""}.`,
        entity: "support_request",
        entityId: r.id,
        businessDate: businessDate(ctx.now, await loadSettings(tx)),
      });
      return { ok: true as const };
    });
  },
});

export const resolveSupportRequest = defineHandler({
  auth: OPS,
  input: z.object({ requestId: id }).strict(),
  output: ok,
  async run(ctx, input) {
    const moved = await ctx.db.supportRequest.updateMany({
      where: { id: input.requestId, status: "open" },
      data: { status: "resolved", resolved_by: ctx.actor.userId, resolved_at: ctx.now },
    });
    if (!moved.count)
      throw new DomainError(409, "already_resolved", "This request is already resolved.");
    return { ok: true as const };
  },
});

export const opsViews: Record<string, AnyHandler> = {
  getOpsOverview,
  getOpsAlerts,
  getCatalogue,
  getPricingBoard,
  getLiquidityBoard,
  getOpsInventory,
  getExceptionQueue,
  getHubsBoard,
  getUsersBoard,
  getMetrics,
  getFinanceBoard,
  getAuditLog,
  getSupportInbox,
  getMySupport,
};
export const opsCommands: Record<string, AnyHandler> = {
  saveDeviceModel,
  savePricingSettings,
  setIcPaused,
  setListingOverride,
  markRefurbishedAndList,
  liquidateDevice,
  resolveExceptionCase,
  collectMismatchFee,
  upholdGrade,
  saveHub,
  saveUserAccess,
  inviteStaff,
  submitSupportRequest,
  replySupportRequest,
  resolveSupportRequest,
};

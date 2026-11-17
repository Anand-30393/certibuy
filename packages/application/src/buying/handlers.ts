// Buyer journey (B-01 … B-12), returns (B-09, T-08, O-07) and the approved DOA replacement.
// Buyers never see seller identity, acquisition cost or floor prices (CLAUDE.md §2.5).
import {
  AdvanceShipmentInput,
  CancelOrderInput,
  CartInput,
  CartView,
  ConfirmationView,
  EmptyInput,
  ListingDetailView,
  ListingIdInput,
  MyOrdersView,
  OpsOrdersView,
  OpsReturnsView,
  OrderIdInput,
  OrderIdsInput,
  OrderTrackingView,
  PlaceOrdersInput,
  PlaceOrdersOutput,
  RaiseReturnInput,
  RETURN_REASONS,
  ResolveReturnInput,
  ReturnIdInput,
  ReturnInspectionInput,
  ReturnJobView,
  ReturnOptionsView,
  ShopCatalogueInput,
  ShopCatalogueView,
  ShopHomeView,
  TECH_CHECKLIST,
  type ListingCardT,
} from "@certibuy/contracts";
import { fromIsoDate, toIsoDate, type Prisma } from "@certibuy/db";
import {
  assertCanRaiseReturn,
  cancelOrder as domainCancelOrder,
  DomainError,
  estimateRefund,
  formatInr,
  normaliseIndianMobile,
  OUTCOMES_FOR,
  orderTotal,
  partitionCart,
  percentOf,
  pickReplacement,
  planListing,
  replacementAllowed,
  resolveReturn as domainResolveReturn,
  returnWindowClosesAt,
  type Grade,
  type ReturnOutcome,
  type ReturnReason,
} from "@certibuy/domain";
import { PRIVATE_MEDIA_BUCKET } from "@certibuy/integrations";
import { z } from "zod";
import type { Actor } from "../actor";
import { AccessDenied } from "../actor";
import { assertHubAccess, canSeeAll } from "../policies";
import { defineHandler, type AnyHandler } from "../registry";
import { storedPhotos, today } from "../selling/queries";
import { loadSettings } from "../settings";
import { logActivity, notify, type Tx } from "../support";

const CUSTOMER = ["customer"] as const;
const OPS = ["ops"] as const;
const STAFF = ["technician", "ops"] as const;
const LABEL_SHOTS = new Set(["imei_label", "serial_label"]); // never shown to buyers

const listingInclude = {
  device: {
    include: {
      device_model: true,
      hub: true,
      submission: {
        include: { inspection_reports: { where: { type: "intake" }, take: 1 } },
      },
    },
  },
} satisfies Prisma.ListingInclude;
type LoadedListing = Prisma.ListingGetPayload<{ include: typeof listingInclude }>;

const orderInclude = {
  device: { include: { device_model: true } },
  escrow_transactions: { orderBy: { created_date: "asc" } },
  return_requests: { orderBy: { created_date: "desc" } },
  shipments: { orderBy: { created_date: "asc" } },
} satisfies Prisma.OrderInclude;
type LoadedOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

const deviceName = (m: { brand: string; model: string; storage: string }) =>
  `${m.brand} ${m.model} ${m.storage}`;
const orderNo = (id: string) => `CB-${id.slice(-6).toUpperCase()}`;
const priceOf = (l: { override_price: number | null; current_price: number }) =>
  l.override_price ?? l.current_price;
const isLive = (l: { status: string; device: { owner: string } }) =>
  l.status === "active" && l.device.owner === "certibuy";

function toCard(l: LoadedListing): ListingCardT {
  const report = l.device.submission.inspection_reports[0];
  return {
    listingId: l.id,
    brand: l.device.device_model.brand,
    model: l.device.device_model.model,
    storage: l.device.device_model.storage,
    category: l.device.device_model.category,
    colour: l.device.colour,
    grade: l.device.final_grade,
    batteryHealth: report?.battery_health ?? null,
    price: priceOf(l),
    basePrice: l.base_price,
    stepped: priceOf(l) < l.base_price,
    warrantyMonths: l.warranty_months,
    hubCity: l.device.hub.city,
    imageUrl: l.device.device_model.image_url,
  };
}

async function liveListings(tx: Tx): Promise<LoadedListing[]> {
  return tx.listing.findMany({
    where: { status: "active", device: { owner: "certibuy" } },
    include: listingInclude,
    orderBy: { created_date: "desc" },
    take: 500,
  });
}

async function loadOrder(tx: Tx, actor: Actor, orderId: string): Promise<LoadedOrder> {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: orderInclude });
  if (!order) throw new DomainError(404, "not_found", "We couldn't find that order.");
  if (order.buyer_id !== actor.userId && !canSeeAll(actor)) {
    throw new AccessDenied(403, "not_owner", "That order belongs to someone else.");
  }
  return order;
}

/** The unit the buyer currently holds: the replacement once one has been allocated. */
const currentDeviceId = (o: { device_id: string; replacement_device_id: string | null }) =>
  o.replacement_device_id ?? o.device_id;

function nextActionFor(o: { status: string }): string | null {
  return (
    {
      paid: "Track your order",
      dispatched: "Track your order",
      in_transit: "Track your order",
      delivered: "Check it and keep it, or raise a return",
      replaced: "Track your replacement",
    }[o.status] ?? null
  );
}

function summary(o: LoadedOrder) {
  return {
    orderId: o.id,
    orderNo: orderNo(o.id),
    device: deviceName(o.device.device_model),
    grade: o.device.final_grade,
    status: o.status,
    escrowStatus: o.escrow_status,
    total: o.total,
    placedAt: o.created_date.toISOString(),
    nextAction: nextActionFor(o),
  };
}

// --------------------------------------------------------------------------- catalogue views

const GRADE_RANK: Record<Grade, number> = { A: 0, B: 1, C: 2, D: 3 };

/** B-02: browse with filters, four sorts and facets computed on the server. */
export const getShopCatalogue = defineHandler({
  auth: CUSTOMER,
  input: ShopCatalogueInput,
  output: ShopCatalogueView,
  async run(ctx, f) {
    const all = (await liveListings(ctx.db)).map(toCard);
    const q = f.q?.toLowerCase();
    const items = all.filter(
      (c) =>
        (!q || `${c.brand} ${c.model} ${c.storage}`.toLowerCase().includes(q)) &&
        (!f.category || c.category === f.category) &&
        (!f.brand || c.brand === f.brand) &&
        (!f.grade || c.grade === f.grade) &&
        (!f.storage || c.storage === f.storage) &&
        (f.priceMin === undefined || c.price >= f.priceMin) &&
        (f.priceMax === undefined || c.price <= f.priceMax) &&
        (!f.warrantyOnly || c.warrantyMonths > 0),
    );
    const sorters: Record<string, (a: ListingCardT, b: ListingCardT) => number> = {
      price_asc: (a, b) => a.price - b.price,
      price_desc: (a, b) => b.price - a.price,
      grade: (a, b) => GRADE_RANK[a.grade] - GRADE_RANK[b.grade] || a.price - b.price,
    };
    const sorter = f.sort ? sorters[f.sort] : undefined;
    if (sorter) items.sort(sorter);
    const uniq = <T>(xs: T[]) => [...new Set(xs)].sort();
    return {
      items,
      total: items.length,
      facets: {
        brands: uniq(all.map((c) => c.brand)),
        storages: uniq(all.map((c) => c.storage)),
        categories: uniq(all.map((c) => c.category)),
      },
    };
  },
});

/** B-01: shop home rows. */
export const getShopHome = defineHandler({
  auth: CUSTOMER,
  input: EmptyInput,
  output: ShopHomeView,
  async run(ctx) {
    const cards = (await liveListings(ctx.db)).map(toCard);
    return {
      newest: cards.slice(0, 8),
      gradeA: cards.filter((c) => c.grade === "A").slice(0, 8),
      listedCount: cards.length,
    };
  },
});

/** B-03: listing detail with the sealed inspection report and price history. */
export const getListingDetail = defineHandler({
  auth: CUSTOMER,
  input: ListingIdInput,
  output: ListingDetailView,
  async run(ctx, input) {
    const s = await loadSettings(ctx.db);
    const l = await ctx.db.listing.findUnique({
      where: { id: input.listingId },
      include: listingInclude,
    });
    // Only live, reserved or sold listings are visible beyond ops (docs/roles.md.txt §6).
    if (!l || !["active", "reserved", "sold"].includes(l.status)) {
      throw new DomainError(404, "not_found", "That device isn't listed any more.");
    }
    const report = l.device.submission.inspection_reports[0] ?? null;
    const shots = storedPhotos(l.device.submission).filter((p) => !LABEL_SHOTS.has(p.key));
    const photos = (
      await Promise.all(
        shots.map(async (p) => ({
          label: p.label,
          url: await ctx.storage.signedDownloadUrl(PRIVATE_MEDIA_BUCKET, p.path, 600),
        })),
      )
    ).filter((p): p is { label: string; url: string } => Boolean(p.url));
    const checklist = (report?.checklist ?? {}) as Record<string, string>;
    const price = priceOf(l);
    return {
      card: toCard(l),
      available: isLive(l),
      photos,
      inspection: report
        ? {
            checklist: TECH_CHECKLIST.map((c) => ({
              label: c.label,
              result: checklist[c.key] ?? "—",
            })),
            batteryHealth: report.battery_health,
            cosmeticGrade: report.cosmetic_grade,
            componentGrades: (report.component_grades ?? null) as Record<string, Grade> | null,
            inspectedOn: report.sealed_at ? report.sealed_at.toISOString() : null,
            hubName: l.device.hub.name,
          }
        : null,
      priceHistory: {
        basePrice: l.base_price,
        currentPrice: price,
        ladderStep: l.ladder_step,
        listedAt: toIsoDate(l.listed_at),
      },
      addonPrice: percentOf(price, s.warranty_addon_pct),
      addonAvailable: l.warranty_months > 0,
      returnWindowDays: s.return_window_days,
    };
  },
});

/** Cart + checkout data: every line re-validated on the server; delivery defaults from the profile. */
export const getCart = defineHandler({
  auth: CUSTOMER,
  input: CartInput,
  output: CartView,
  async run(ctx, input) {
    const s = await loadSettings(ctx.db);
    const ids = [
      ...new Set(
        input.ids
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    ].slice(0, 20);
    const listings = await ctx.db.listing.findMany({
      where: { id: { in: ids } },
      include: listingInclude,
    });
    const profile = await ctx.db.profile.findUniqueOrThrow({ where: { id: ctx.actor.userId } });
    return {
      items: ids.map((listingId) => {
        const l = listings.find((x) => x.id === listingId);
        const available = Boolean(l && isLive(l));
        return {
          listingId,
          available,
          reason: available ? null : "This device is no longer available.",
          card: l ? toCard(l) : null,
          addonPrice: l ? percentOf(priceOf(l), s.warranty_addon_pct) : 0,
          addonAvailable: Boolean(l && l.warranty_months > 0),
        };
      }),
      delivery: {
        name: profile.full_name ?? "",
        phone: profile.phone ?? "",
        address: profile.delivery_address ?? "",
      },
      returnWindowDays: s.return_window_days,
    };
  },
});

// --------------------------------------------------------------------------- checkout

/**
 * B-05 (Option A): one checkout, one simulated payment, one order per device. Each line is
 * reserved in its own transaction with a conditional update, so a device bought by someone else
 * moments earlier is removed and never charged; the other lines still go through.
 */
export const placeOrders = defineHandler({
  auth: CUSTOMER,
  input: PlaceOrdersInput,
  output: PlaceOrdersOutput,
  async run(ctx, input) {
    const s = await loadSettings(ctx.db);
    const day = today(ctx, s);
    const phone = normaliseIndianMobile(input.deliveryPhone);
    if (!phone)
      throw new DomainError(400, "bad_phone", "Enter a valid 10-digit Indian mobile number.");

    const listings = await ctx.db.listing.findMany({
      where: { id: { in: input.items.map((i) => i.listingId) } },
      include: listingInclude,
    });
    const { purchasable, removed } = partitionCart(
      input.items,
      input.items.map((i) => {
        const l = listings.find((x) => x.id === i.listingId);
        return {
          listingId: i.listingId,
          status: l?.status ?? "missing",
          available: Boolean(l && isLive(l)),
        };
      }),
    );
    // Price each line from the listing (never from the browser); rejects the add-on on 0-month listings.
    const priced = purchasable.map((line) => {
      const l = listings.find((x) => x.id === line.listingId) as LoadedListing;
      return {
        line,
        listing: l,
        ...orderTotal(
          {
            currentPrice: l.current_price,
            overridePrice: l.override_price,
            warrantyMonths: l.warranty_months,
            warrantyAddon: line.warrantyAddon,
          },
          s,
        ),
      };
    });
    const total = priced.reduce((a, p) => a + p.total, 0);

    // Simulated authorisation: a declined payment writes nothing at all.
    if (input.declined) return { declined: true, total, orders: [], removed };

    const orders: { orderId: string; listingId: string; total: number }[] = [];
    for (const p of priced) {
      const created = await ctx.db.$transaction(async (tx) => {
        const reserved = await tx.listing.updateMany({
          where: { id: p.listing.id, status: "active" },
          data: { status: "reserved", reserved_days: { increment: 1 } },
        });
        if (reserved.count === 0) return null; // taken in the meantime: not charged
        const order = await tx.order.create({
          data: {
            listing_id: p.listing.id,
            device_id: p.listing.device_id,
            buyer_id: ctx.actor.userId,
            device_price: p.devicePrice,
            warranty_addon: p.line.warrantyAddon,
            warranty_addon_amount: p.warrantyAddonAmount,
            total: p.total,
            delivery_name: input.deliveryName,
            delivery_phone: phone,
            delivery_address: input.deliveryAddress,
            payment_method: input.paymentMethod,
            status: "paid",
            escrow_status: "hold",
            paid_at: ctx.now,
          },
        });
        await tx.escrowTransaction.create({
          data: {
            order_id: order.id,
            buyer_id: ctx.actor.userId,
            type: "hold",
            amount: p.total,
            note: "Payment held in escrow",
          },
        });
        await tx.paymentIntent.create({
          data: {
            order_id: order.id,
            provider: "simulated",
            reference: `SIM-PAY-${order.id.slice(-8).toUpperCase()}`,
            amount: p.total,
            status: "captured",
          },
        });
        await tx.device.update({
          where: { id: p.listing.device_id },
          data: { status: "reserved" },
        });
        // Sell For More: the buyer paying makes the seller's due balance payable (D4).
        await tx.payout.updateMany({
          where: { device_id: p.listing.device_id, type: "balance", status: "due" },
          data: { status: "pending", trigger: "buyer_paid_escrow" },
        });
        await logActivity(tx, {
          actor: ctx.actor,
          text: `Order ${orderNo(order.id)} paid: ${deviceName(p.listing.device.device_model)} for ${formatInr(p.total)} (held in escrow).`,
          entity: "order",
          entityId: order.id,
          businessDate: day,
        });
        await notify(
          tx,
          [
            {
              userId: ctx.actor.userId,
              event: "order_placed",
              title: `Order ${orderNo(order.id)} confirmed`,
              body: `${deviceName(p.listing.device.device_model)} — ${formatInr(p.total)} held safely in escrow until your return window closes.`,
              link: `/shop/orders/${order.id}`,
            },
          ],
          ctx.env.appPublicUrl,
        );
        return order;
      });
      if (created)
        orders.push({ orderId: created.id, listingId: p.listing.id, total: created.total });
      else
        removed.push({
          listingId: p.listing.id,
          reason: "Someone else bought this device moments ago.",
        });
    }

    if (removed.length) {
      await ctx.db.$transaction(async (tx) => {
        await notify(
          tx,
          removed.map((r) => ({
            userId: ctx.actor.userId,
            event: "cart_item_unavailable",
            title: "A device in your cart was unavailable",
            body: `${r.reason} You were not charged for it.`,
            link: "/shop/browse",
          })),
          ctx.env.appPublicUrl,
        );
      });
    }
    return { declined: false, total: orders.reduce((a, o) => a + o.total, 0), orders, removed };
  },
});

// --------------------------------------------------------------------------- order views

export const getMyOrders = defineHandler({
  auth: CUSTOMER,
  input: EmptyInput,
  output: MyOrdersView,
  async run(ctx) {
    const orders = await ctx.db.order.findMany({
      where: { buyer_id: ctx.actor.userId },
      include: orderInclude,
      orderBy: { created_date: "desc" },
      take: 100,
    });
    return { items: orders.map(summary) };
  },
});

/** B-06: one confirmation for every order created by a checkout. */
export const getConfirmation = defineHandler({
  auth: CUSTOMER,
  input: OrderIdsInput,
  output: ConfirmationView,
  async run(ctx, input) {
    const s = await loadSettings(ctx.db);
    const ids = input.ids.split(",").filter(Boolean).slice(0, 10);
    const orders = await ctx.db.order.findMany({
      where: { id: { in: ids }, buyer_id: ctx.actor.userId },
      include: orderInclude,
    });
    return {
      orders: orders.map((o) => ({
        ...summary(o),
        devicePrice: o.device_price,
        warrantyAddonAmount: o.warranty_addon_amount,
        deliveryName: o.delivery_name,
        deliveryAddress: o.delivery_address,
        paymentMethod: o.payment_method,
      })),
      returnWindowDays: s.return_window_days,
    };
  },
});

const REPLACEMENT_AWB = "REPLACEMENT";
const NEXT_SHIPMENT: Record<string, "dispatched" | "in_transit" | "delivered" | undefined> = {
  none: "dispatched",
  dispatched: "in_transit",
  in_transit: "delivered",
};
function replacementStage(o: LoadedOrder): string {
  const rows = o.shipments.filter((sh) => sh.awb === REPLACEMENT_AWB);
  return rows[rows.length - 1]?.status ?? "none";
}

/** B-07: tracking, return window, refund/replacement card. */
export const getOrderTracking = defineHandler({
  auth: ["customer", "ops"],
  input: OrderIdInput,
  output: OrderTrackingView,
  async run(ctx, input) {
    const s = await loadSettings(ctx.db);
    const day = today(ctx, s);
    const o = await loadOrder(ctx.db, ctx.actor, input.orderId);
    const ret = o.return_requests[0] ?? null;
    const closes = o.return_window_closes_at ? toIsoDate(o.return_window_closes_at) : null;
    const refundRow = o.escrow_transactions.find(
      (t) => t.type === "refund_full" || t.type === "refund_partial",
    );
    const timeline = [
      { label: "Paid — held in escrow", at: (o.paid_at ?? o.created_date).toISOString() },
      ...(o.dispatched_at ? [{ label: "Dispatched", at: o.dispatched_at.toISOString() }] : []),
      ...(o.in_transit_at ? [{ label: "In transit", at: o.in_transit_at.toISOString() }] : []),
      ...o.shipments
        .filter((sh) => sh.awb === REPLACEMENT_AWB)
        .map((sh) => ({
          label: `Replacement ${sh.status.replace("_", " ")}`,
          at: sh.created_date.toISOString(),
        })),
      ...(o.delivered_at ? [{ label: "Delivered", at: toIsoDate(o.delivered_at) }] : []),
      ...(o.cancelled_at ? [{ label: "Cancelled", at: o.cancelled_at.toISOString() }] : []),
      ...(o.refunded_at ? [{ label: "Refunded", at: o.refunded_at.toISOString() }] : []),
      ...(o.settled_at
        ? [{ label: "Complete — escrow released", at: o.settled_at.toISOString() }]
        : []),
    ];
    let replacement = null;
    if (o.replacement_device_id) {
      const d = await ctx.db.device.findUnique({
        where: { id: o.replacement_device_id },
        include: { device_model: true },
      });
      if (d)
        replacement = {
          device: deviceName(d.device_model),
          grade: d.final_grade,
          stage: replacementStage(o),
        };
    }
    const cancel = ["pending", "paid"].includes(o.status)
      ? domainCancelOrder({ orderStatus: o.status, total: o.total }, s)
      : null;
    const isBuyer = o.buyer_id === ctx.actor.userId;
    const shippable =
      ["paid", "dispatched", "in_transit"].includes(o.status) ||
      (o.status === "replaced" && replacementStage(o) !== "delivered");
    return {
      summary: summary(o),
      amounts: {
        devicePrice: o.device_price,
        warrantyAddonAmount: o.warranty_addon_amount,
        total: o.total,
      },
      delivery: { name: o.delivery_name, phone: o.delivery_phone, address: o.delivery_address },
      paymentMethod: o.payment_method,
      timeline,
      returnWindowClosesAt: closes,
      canCancel: isBuyer && Boolean(cancel),
      cancelRefund: cancel?.refund ?? 0,
      canReturn:
        isBuyer &&
        ["delivered", "settled"].includes(o.status) &&
        closes !== null &&
        day <= closes &&
        !(ret && ret.status !== "resolved"),
      refund: refundRow
        ? { amount: refundRow.amount, at: refundRow.created_date.toISOString() }
        : null,
      openReturn: ret
        ? {
            returnId: ret.id,
            reason: ret.reason,
            status: ret.status,
            recommendation: ret.recommendation,
            outcome: ret.outcome,
            refund: ret.refund_amount,
            deduction: ret.deduction_amount,
          }
        : null,
      replacement,
      // Logistics are simulated: in demo mode the buyer may advance their own shipment (prototype control).
      canAdvanceShipment: shippable && (canSeeAll(ctx.actor) || (isBuyer && s.demo_mode)),
    };
  },
});

/** B-09: eligibility and the estimated refund for each reason, before submitting. */
export const getReturnOptions = defineHandler({
  auth: CUSTOMER,
  input: OrderIdInput,
  output: ReturnOptionsView,
  async run(ctx, input) {
    const s = await loadSettings(ctx.db);
    const o = await loadOrder(ctx.db, ctx.actor, input.orderId);
    const closes = o.return_window_closes_at ? toIsoDate(o.return_window_closes_at) : null;
    let reason: string | null = null;
    try {
      assertCanRaiseReturn({
        orderStatus: o.status,
        closesAt: closes,
        today: today(ctx, s),
        hasOpenReturn: o.return_requests.some((r) => r.status !== "resolved"),
      });
    } catch (e) {
      reason = e instanceof DomainError ? e.message : "This order can't be returned.";
    }
    return {
      orderNo: orderNo(o.id),
      device: deviceName(o.device.device_model),
      eligible: reason === null,
      reason,
      closesAt: closes,
      options: (Object.keys(RETURN_REASONS) as ReturnReason[]).map((r) => ({
        reason: r,
        label: RETURN_REASONS[r],
        ...estimateRefund(r, o.total, s),
      })),
      replacementAllowed: replacementAllowed({ replacementDeviceId: o.replacement_device_id }),
    };
  },
});

// --------------------------------------------------------------------------- order commands

async function lockOrder(tx: Tx, orderId: string): Promise<void> {
  await tx.$executeRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
}

/** B-12: cancel before dispatch; a paid order is refunded total − cancel_fee (0 = full refund). */
export const cancelOrder = defineHandler({
  auth: ["customer", "ops"],
  input: CancelOrderInput,
  output: z.object({
    ok: z.literal(true),
    already: z.boolean(),
    orderStatus: z.string(),
    refund: z.number(),
    deduction: z.number(),
    escrow: z.string().nullable(),
  }),
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      await lockOrder(tx, input.orderId);
      const o = await loadOrder(tx, ctx.actor, input.orderId);
      const r = domainCancelOrder({ orderStatus: o.status, total: o.total }, s);
      if (r.already) {
        return {
          ok: true as const,
          already: true,
          orderStatus: "cancelled",
          refund: o.refund_amount ?? 0,
          deduction: 0,
          escrow: o.escrow_status,
        };
      }
      if (r.escrowTx) {
        await tx.escrowTransaction.create({
          data: {
            order_id: o.id,
            buyer_id: o.buyer_id,
            type: r.escrowTx,
            amount: r.refund,
            note: "Cancelled before dispatch",
          },
        });
      }
      await tx.order.update({
        where: { id: o.id },
        data: {
          status: "cancelled",
          escrow_status: r.escrowStatus,
          cancelled_at: ctx.now,
          cancel_reason: input.reason ?? null,
          ...(r.escrowTx ? { refund_amount: r.refund, refunded_at: ctx.now } : {}),
        },
      });
      // Back on the shelf with its reserved days kept; seller payouts are never reversed.
      await tx.listing.updateMany({
        where: { id: o.listing_id, status: "reserved" },
        data: { status: "active" },
      });
      await tx.device.update({ where: { id: o.device_id }, data: { status: "listed" } });
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Order ${orderNo(o.id)} cancelled before dispatch${r.escrowTx ? `; ${formatInr(r.refund)} refunded` : ""}.`,
        entity: "order",
        entityId: o.id,
        businessDate: today(ctx, s),
      });
      await notify(
        tx,
        [
          {
            userId: o.buyer_id,
            event: "order_cancelled",
            title: `Order ${orderNo(o.id)} cancelled`,
            body: r.escrowTx
              ? `${formatInr(r.refund)} is being refunded to you (simulated).`
              : "No payment was taken.",
            link: `/shop/orders/${o.id}`,
          },
        ],
        ctx.env.appPublicUrl,
      );
      return {
        ok: true as const,
        already: false,
        orderStatus: "cancelled",
        refund: r.refund,
        deduction: r.deduction,
        escrow: r.escrowStatus,
      };
    });
  },
});

/**
 * B-07 / ops: simulated courier — paid → dispatched → in transit → delivered. Delivery starts the
 * return window (D3). For a DOA replacement the same order ships the replacement unit; its
 * delivery restarts the window and puts the escrow back on hold (approved flow, open item 8).
 */
export const advanceShipment = defineHandler({
  auth: ["customer", "ops"],
  input: AdvanceShipmentInput,
  output: z.object({ ok: z.literal(true), status: z.string(), replacement: z.boolean() }),
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const day = today(ctx, s);
      await lockOrder(tx, input.orderId);
      const o = await loadOrder(tx, ctx.actor, input.orderId);
      if (!canSeeAll(ctx.actor) && !s.demo_mode) {
        throw new AccessDenied(403, "ops_only", "Shipments are updated by operations.");
      }
      const notifyBuyer = (event: string, title: string, body: string) =>
        notify(
          tx,
          [{ userId: o.buyer_id, event, title, body, link: `/shop/orders/${o.id}` }],
          ctx.env.appPublicUrl,
        );

      if (o.status === "replaced") {
        const next = NEXT_SHIPMENT[replacementStage(o)];
        const replacementId = o.replacement_device_id;
        if (!next || !replacementId)
          throw new DomainError(
            409,
            "no_next_state",
            "The replacement has already been delivered.",
          );
        await tx.shipment.create({
          data: { order_id: o.id, status: next, awb: REPLACEMENT_AWB, actor_id: ctx.actor.userId },
        });
        if (next === "delivered") {
          await tx.order.update({
            where: { id: o.id },
            data: {
              status: "delivered",
              escrow_status: "hold",
              delivered_at: fromIsoDate(day),
              return_window_closes_at: fromIsoDate(returnWindowClosesAt(day, s)),
            },
          });
          await tx.device.update({ where: { id: replacementId }, data: { status: "delivered" } });
          await notifyBuyer(
            "order_delivered",
            "Your replacement was delivered",
            `Your ${s.return_window_days}-day return window starts today.`,
          );
        } else {
          await tx.device.update({ where: { id: replacementId }, data: { status: "shipped" } });
          if (next === "dispatched")
            await notifyBuyer(
              "order_dispatched",
              "Your replacement is on its way",
              "Track it from your order page.",
            );
        }
        return { ok: true as const, status: next, replacement: true };
      }

      const next = (
        { paid: "dispatched", dispatched: "in_transit", in_transit: "delivered" } as const
      )[o.status as "paid" | "dispatched" | "in_transit"];
      if (!next)
        throw new DomainError(409, "no_next_state", "This order has no next shipment step.");
      await tx.shipment.create({
        data: { order_id: o.id, status: next, actor_id: ctx.actor.userId },
      });
      if (next === "dispatched") {
        await tx.order.update({
          where: { id: o.id },
          data: { status: "dispatched", dispatched_at: ctx.now },
        });
        await tx.device.update({ where: { id: o.device_id }, data: { status: "shipped" } });
        await notifyBuyer(
          "order_dispatched",
          `Order ${orderNo(o.id)} dispatched`,
          "Your device is on its way (simulated courier).",
        );
      } else if (next === "in_transit") {
        await tx.order.update({
          where: { id: o.id },
          data: { status: "in_transit", in_transit_at: ctx.now },
        });
      } else {
        await tx.order.update({
          where: { id: o.id },
          data: {
            status: "delivered",
            delivered_at: fromIsoDate(day),
            return_window_closes_at: fromIsoDate(returnWindowClosesAt(day, s)),
          },
        });
        await tx.device.update({ where: { id: o.device_id }, data: { status: "delivered" } });
        await tx.listing.update({ where: { id: o.listing_id }, data: { status: "sold" } });
        await notifyBuyer(
          "order_delivered",
          `Order ${orderNo(o.id)} delivered`,
          `You have ${s.return_window_days} days, until ${returnWindowClosesAt(day, s)}, to raise a return.`,
        );
      }
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Order ${orderNo(o.id)} ${next.replace("_", " ")}.`,
        entity: "order",
        entityId: o.id,
        businessDate: day,
      });
      return { ok: true as const, status: next, replacement: false };
    });
  },
});

// --------------------------------------------------------------------------- returns

/** B-09: raise a return inside the window (one open return per order). */
export const raiseReturn = defineHandler({
  auth: CUSTOMER,
  input: RaiseReturnInput,
  output: z.object({
    ok: z.literal(true),
    returnId: z.string(),
    original: z.number(),
    deduction: z.number(),
    refund: z.number(),
  }),
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const day = today(ctx, s);
      await lockOrder(tx, input.orderId);
      const o = await loadOrder(tx, ctx.actor, input.orderId);
      if (o.buyer_id !== ctx.actor.userId)
        throw new AccessDenied(403, "not_owner", "Only the buyer can raise a return.");
      assertCanRaiseReturn({
        orderStatus: o.status,
        closesAt: o.return_window_closes_at ? toIsoDate(o.return_window_closes_at) : null,
        today: day,
        hasOpenReturn: o.return_requests.some((r) => r.status !== "resolved"),
      });
      const wantsReplacement =
        input.reason === "dead_on_arrival" && input.doaPreference === "replacement";
      if (
        wantsReplacement &&
        !replacementAllowed({ replacementDeviceId: o.replacement_device_id })
      ) {
        throw new DomainError(
          409,
          "replacement_used",
          "This order has already had a replacement. Choose a refund instead.",
        );
      }
      const deviceId = currentDeviceId(o);
      const device = await tx.device.findUniqueOrThrow({ where: { id: deviceId } });
      const estimate = estimateRefund(input.reason, o.total, s);
      const ret = await tx.returnRequest.create({
        data: {
          order_id: o.id,
          buyer_id: o.buyer_id,
          device_id: deviceId,
          hub_id: device.hub_id,
          reason: input.reason,
          buyer_reason_note: input.note ?? null,
          doa_preference:
            input.reason === "dead_on_arrival" ? (input.doaPreference ?? "refund") : null,
          original_amount: o.total,
        },
      });
      await tx.exceptionCase.create({
        data: {
          type: "return",
          title: `Return ${orderNo(o.id)}: ${RETURN_REASONS[input.reason]}`,
          detail: input.note ?? null,
          related_entity: "return_request",
          related_id: ret.id,
        },
      });
      await tx.device.update({
        where: { id: deviceId },
        data: { status: "returned", return_count: { increment: 1 } },
      });
      await tx.profile.update({
        where: { id: o.buyer_id },
        data: { return_count: { increment: 1 } },
      }); // F16
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Return raised on ${orderNo(o.id)}: ${RETURN_REASONS[input.reason]}.`,
        entity: "order",
        entityId: o.id,
        businessDate: day,
      });
      const ops = await tx.profile.findMany({
        where: { OR: [{ app_role: "ops" }, { is_platform_admin: true }] },
        select: { id: true },
      });
      await notify(
        tx,
        ops.map((u) => ({
          userId: u.id,
          event: "return_raised",
          title: `Return raised: ${orderNo(o.id)}`,
          body: `${RETURN_REASONS[input.reason]} — awaiting re-inspection.`,
          link: "/ops/returns",
        })),
        ctx.env.appPublicUrl,
      );
      return { ok: true as const, returnId: ret.id, ...estimate };
    });
  },
});

async function loadReturn(tx: Tx, id: string) {
  const r = await tx.returnRequest.findUnique({
    where: { id },
    include: { order: true, device: { include: { device_model: true } } },
  });
  if (!r) throw new DomainError(404, "not_found", "We couldn't find that return.");
  return r;
}

/** T-08: return re-inspection job (hub-scoped). */
export const getReturnJob = defineHandler({
  auth: STAFF,
  input: ReturnIdInput,
  output: ReturnJobView,
  async run(ctx, input) {
    const r = await loadReturn(ctx.db, input.returnId);
    assertHubAccess(ctx.actor, r.hub_id ?? r.device.hub_id);
    return {
      returnId: r.id,
      status: r.status,
      hubId: r.hub_id ?? r.device.hub_id,
      device: deviceName(r.device.device_model),
      grade: r.device.final_grade,
      tagId: r.device.tag_id,
      reason: r.reason,
      note: r.buyer_reason_note,
      doaPreference: r.doa_preference,
      recommendation: r.recommendation,
      raisedOn: r.created_date.toISOString(),
    };
  },
});

/** T-08: technician records the re-inspection recommendation. */
export const returnInspection = defineHandler({
  auth: STAFF,
  input: ReturnInspectionInput,
  output: z.object({ ok: z.literal(true) }),
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const r = await loadReturn(tx, input.returnId);
      const hubId = r.hub_id ?? r.device.hub_id;
      assertHubAccess(ctx.actor, hubId);
      if (r.status !== "awaiting_reinspection") {
        throw new DomainError(
          409,
          "already_inspected",
          "This return has already been re-inspected.",
        );
      }
      const report = await tx.inspectionReport.create({
        data: {
          type: "return",
          return_request_id: r.id,
          hub_id: hubId,
          technician_id: ctx.actor.userId,
          battery_health: input.batteryHealth ?? null,
          notes: input.notes ?? null,
          return_recommendation: input.recommendation,
          sealed: true,
          sealed_at: ctx.now,
        },
      });
      await tx.returnRequest.update({
        where: { id: r.id },
        data: {
          status: "awaiting_decision",
          recommendation: input.recommendation,
          report_id: report.id,
        },
      });
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Return re-inspected: recommendation ${input.recommendation.replace("_", " ")}.`,
        entity: "order",
        entityId: r.order_id,
        businessDate: today(ctx, s),
      });
      const ops = await tx.profile.findMany({
        where: { OR: [{ app_role: "ops" }, { is_platform_admin: true }] },
        select: { id: true },
      });
      await notify(
        tx,
        [
          {
            userId: r.buyer_id,
            event: "return_inspected",
            title: "Your return was re-inspected",
            body: "Operations will confirm the outcome shortly.",
            link: `/shop/orders/${r.order_id}`,
          },
          ...ops.map((u) => ({
            userId: u.id,
            event: "return_inspection",
            title: "Return ready for a decision",
            body: `Recommendation: ${input.recommendation.replace("_", " ")}.`,
            link: "/ops/returns",
          })),
        ],
        ctx.env.appPublicUrl,
      );
      return { ok: true as const };
    });
  },
});

async function replacementCandidates(tx: Tx, deviceModelId: string) {
  const listings = await tx.listing.findMany({
    where: { status: "active", device: { owner: "certibuy", device_model_id: deviceModelId } },
    include: { device: { include: { device_model: true } } },
  });
  return listings.map((l) => ({
    listingId: l.id,
    deviceModelId: l.device.device_model_id,
    grade: l.device.final_grade,
    price: priceOf(l),
    status: l.status,
    deviceId: l.device_id,
    device: deviceName(l.device.device_model),
  }));
}

/** O-07: ops resolve a return. Refunds go through the escrow ledger; DOA replacement follows the approved flow. */
export const resolveReturn = defineHandler({
  auth: OPS,
  input: ResolveReturnInput,
  output: z.object({
    ok: z.literal(true),
    outcome: z.string(),
    refund: z.number(),
    deduction: z.number(),
    escrow: z.string(),
    orderStatus: z.string(),
    deviceStatus: z.string(),
    replacementListingId: z.string().nullable(),
  }),
  async run(ctx, input) {
    return ctx.db.$transaction(async (tx) => {
      const s = await loadSettings(tx);
      const day = today(ctx, s);
      const r = await loadReturn(tx, input.returnId);
      if (r.status === "resolved")
        throw new DomainError(409, "already_resolved", "This return is already resolved.");
      await lockOrder(tx, r.order_id);
      const order = r.order;
      const res = domainResolveReturn(
        { reason: r.reason, outcome: input.outcome as ReturnOutcome, total: order.total },
        s,
      );

      let replacement: Awaited<ReturnType<typeof replacementCandidates>>[number] | null = null;
      if (input.outcome === "doa_replacement") {
        if (!replacementAllowed({ replacementDeviceId: order.replacement_device_id })) {
          throw new DomainError(
            409,
            "replacement_used",
            "This order has already had a replacement. Resolve as DOA confirmed.",
          );
        }
        const candidates = await replacementCandidates(tx, r.device.device_model_id);
        const pool = input.replacementListingId
          ? candidates.filter((c) => c.listingId === input.replacementListingId)
          : candidates;
        const picked = pickReplacement(
          { deviceModelId: r.device.device_model_id, grade: r.device.final_grade },
          pool,
        );
        replacement = picked
          ? (candidates.find((c) => c.listingId === picked.listingId) ?? null)
          : null;
        if (!replacement) {
          throw new DomainError(
            409,
            "no_replacement",
            "No matching unit is listed. Resolve as DOA confirmed (full refund).",
          );
        }
        const claimed = await tx.listing.updateMany({
          where: { id: replacement.listingId, status: "active" },
          data: { status: "sold" },
        });
        if (claimed.count === 0)
          throw new DomainError(409, "replacement_taken", "That unit was just sold. Try again.");
        await tx.device.update({
          where: { id: replacement.deviceId },
          data: { status: "reserved" },
        });
      }

      if (res.escrowTx) {
        await tx.escrowTransaction.create({
          data: {
            order_id: order.id,
            buyer_id: order.buyer_id,
            type: res.escrowTx,
            amount: res.refund,
            note: `Return resolved: ${input.outcome.replace("_", " ")}`,
            return_request_id: r.id,
          },
        });
      }
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: res.orderStatus,
          escrow_status: res.escrowStatus,
          ...(res.escrowTx ? { refund_amount: res.refund, refunded_at: ctx.now } : {}),
          ...(replacement ? { replacement_device_id: replacement.deviceId } : {}),
        },
      });

      // The returned unit: healthy → back on the shelf at day 0; faulty → refurbishment.
      let deviceStatus: string = "in_refurbishment";
      if (res.deviceAction === "relist") {
        const plan = planListing("relist", r.device.final_grade, r.device.device_model, s);
        if (plan.listingCreated) {
          await tx.listing.create({
            data: {
              device_id: r.device_id,
              base_price: plan.basePrice,
              current_price: plan.basePrice,
              floor_price: plan.floorPrice,
              listed_at: fromIsoDate(day),
              warranty_months: plan.warrantyMonths,
            },
          });
          deviceStatus = "listed";
        }
      }
      await tx.device.update({
        where: { id: r.device_id },
        data: { status: deviceStatus as "listed" | "in_refurbishment" },
      });

      await tx.returnRequest.update({
        where: { id: r.id },
        data: {
          status: "resolved",
          outcome: input.outcome as ReturnOutcome,
          deduction_amount: res.deduction,
          deduction_label: res.deductionLabel,
          refund_amount: res.refund,
          replacement_device_id: replacement?.deviceId ?? null,
          resolved_by: ctx.actor.userId,
          resolved_at: ctx.now,
        },
      });
      await tx.exceptionCase.updateMany({
        where: { related_entity: "return_request", related_id: r.id, status: "open" },
        data: { status: "resolved", resolution: `Resolved as ${input.outcome.replace("_", " ")}.` },
      });
      await logActivity(tx, {
        actor: ctx.actor,
        text: `Return on ${orderNo(order.id)} resolved: ${input.outcome.replace("_", " ")}${res.refund ? `, refund ${formatInr(res.refund)}` : ""}${replacement ? `, replacement ${replacement.device}` : ""}.`,
        entity: "order",
        entityId: order.id,
        businessDate: day,
      });
      await notify(
        tx,
        [
          {
            userId: order.buyer_id,
            event: "return_resolved",
            title: replacement ? "A replacement is on its way" : "Your return is resolved",
            body: replacement
              ? `We're sending a replacement ${replacement.device} (grade ${replacement.grade}) on the same order.`
              : `Refund ${formatInr(res.refund)}${res.deduction ? ` (${formatInr(res.deduction)} deducted)` : ""} — simulated, no real money moves.`,
            link: `/shop/orders/${order.id}`,
          },
        ],
        ctx.env.appPublicUrl,
      );
      return {
        ok: true as const,
        outcome: input.outcome,
        refund: res.refund,
        deduction: res.deduction,
        escrow: res.escrowStatus,
        orderStatus: res.orderStatus,
        deviceStatus,
        replacementListingId: replacement?.listingId ?? null,
      };
    });
  },
});

// --------------------------------------------------------------------------- ops views (minimal)

export const getOpsOrders = defineHandler({
  auth: OPS,
  input: EmptyInput,
  output: OpsOrdersView,
  async run(ctx) {
    const orders = await ctx.db.order.findMany({
      where: { status: { in: ["paid", "dispatched", "in_transit", "replaced", "delivered"] } },
      include: {
        device: { include: { device_model: true } },
        buyer: { select: { full_name: true, email: true } },
      },
      orderBy: { created_date: "desc" },
      take: 100,
    });
    const NEXT: Record<string, string> = {
      paid: "Dispatch",
      dispatched: "Mark in transit",
      in_transit: "Mark delivered",
      replaced: "Ship replacement",
    };
    return {
      orders: orders.map((o) => ({
        orderId: o.id,
        orderNo: orderNo(o.id),
        device: deviceName(o.device.device_model),
        buyer: o.buyer.full_name || o.buyer.email || "Buyer",
        status: o.status,
        next: NEXT[o.status] ?? null,
      })),
    };
  },
});

export const getOpsReturns = defineHandler({
  auth: OPS,
  input: EmptyInput,
  output: OpsReturnsView,
  async run(ctx) {
    const s = await loadSettings(ctx.db);
    const returns = await ctx.db.returnRequest.findMany({
      where: { status: { not: "resolved" } },
      include: { order: true, device: { include: { device_model: true } } },
      orderBy: { created_date: "asc" },
    });
    const out = [];
    for (const r of returns) {
      const candidates = await replacementCandidates(ctx.db, r.device.device_model_id);
      const pick = pickReplacement(
        { deviceModelId: r.device.device_model_id, grade: r.device.final_grade },
        candidates,
      );
      const allowed = replacementAllowed({ replacementDeviceId: r.order.replacement_device_id });
      const full = pick ? candidates.find((c) => c.listingId === pick.listingId) : null;
      out.push({
        returnId: r.id,
        orderNo: orderNo(r.order_id),
        device: deviceName(r.device.device_model),
        grade: r.device.final_grade,
        reason: r.reason,
        note: r.buyer_reason_note,
        doaPreference: r.doa_preference,
        status: r.status,
        recommendation: r.recommendation,
        outcomes: OUTCOMES_FOR[r.reason].map((outcome) => {
          const est = domainResolveReturn({ reason: r.reason, outcome, total: r.order.total }, s);
          return {
            outcome,
            refund: est.refund,
            deduction: est.deduction,
            available: outcome !== "doa_replacement" || (allowed && Boolean(full)),
          };
        }),
        replacement:
          allowed && full
            ? {
                listingId: full.listingId,
                device: full.device,
                grade: full.grade,
                price: full.price,
              }
            : null,
      });
    }
    return { returns: out };
  },
});

/** Hub re-inspection queue entries (T-08), merged into the hub queue view. */
export async function hubReturnQueue(tx: Tx, hubId: string) {
  const returns = await tx.returnRequest.findMany({
    where: { hub_id: hubId, status: "awaiting_reinspection" },
    include: { device: { include: { device_model: true } } },
    orderBy: { created_date: "asc" },
  });
  return returns.map((r) => ({
    returnId: r.id,
    device: deviceName(r.device.device_model),
    reason: r.reason,
    raisedOn: toIsoDate(r.created_date),
  }));
}

export const buyingViews: Record<string, AnyHandler> = {
  getShopCatalogue,
  getShopHome,
  getListingDetail,
  getCart,
  getMyOrders,
  getConfirmation,
  getOrderTracking,
  getReturnOptions,
  getReturnJob,
  getOpsOrders,
  getOpsReturns,
};

export const buyingCommands: Record<string, AnyHandler> = {
  placeOrders,
  cancelOrder,
  advanceShipment,
  raiseReturn,
  returnInspection,
  resolveReturn,
};

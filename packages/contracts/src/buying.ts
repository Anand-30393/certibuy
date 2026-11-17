// Buyer journey contracts (B-01 … B-12), returns (T-08, O-07) and the approved DOA replacement.
import { z } from "zod";
import { CATEGORY, GRADE } from "./selling";

const id = z.string().min(1).max(64);
const Money = z.number().int();
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const RETURN_REASONS = {
  not_as_graded: "Not as graded",
  dead_on_arrival: "Dead on arrival",
  buyer_changed_mind: "I changed my mind",
} as const;
export type ReturnReasonKey = keyof typeof RETURN_REASONS;

export const SHOP_SORTS = ["newest", "price_asc", "price_desc", "grade"] as const;

// --- inputs -----------------------------------------------------------------

export const ShopCatalogueInput = z
  .object({
    q: optionalText(60),
    category: CATEGORY.optional(),
    brand: optionalText(40),
    grade: GRADE.optional(),
    storage: optionalText(20),
    priceMin: z.coerce.number().int().min(0).optional(),
    priceMax: z.coerce.number().int().min(0).optional(),
    warrantyOnly: z.enum(["1"]).optional(),
    sort: z.enum(SHOP_SORTS).optional(),
  })
  .strict();

export const ListingIdInput = z.object({ listingId: id }).strict();

/** Cart lives in the browser; the server re-validates every line (`ids` = comma-separated listing ids). */
export const CartInput = z.object({ ids: z.string().max(1400) }).strict();

export const PlaceOrdersInput = z
  .object({
    items: z
      .array(z.object({ listingId: id, warrantyAddon: z.boolean() }).strict())
      .min(1, "Your cart is empty.")
      .max(10, "You can buy up to 10 devices in one checkout."),
    deliveryName: z.string().trim().min(2, "Enter the recipient's name."),
    deliveryPhone: z.string().trim().min(10).max(16),
    deliveryAddress: z.string().trim().min(10, "Enter the full delivery address."),
    paymentMethod: z.enum(["upi", "card", "netbanking"]),
    declined: z.boolean().optional(),
  })
  .strict();

export const OrderIdInput = z.object({ orderId: id }).strict();
export const OrderIdsInput = z.object({ ids: z.string().max(700) }).strict();

export const CancelOrderInput = z.object({ orderId: id, reason: optionalText(200) }).strict();

export const RaiseReturnInput = z
  .object({
    orderId: id,
    reason: z.enum(["not_as_graded", "dead_on_arrival", "buyer_changed_mind"]),
    note: optionalText(500),
    doaPreference: z.enum(["refund", "replacement"]).optional(),
  })
  .strict();

export const ReturnIdInput = z.object({ returnId: id }).strict();

export const ReturnInspectionInput = z
  .object({
    returnId: id,
    recommendation: z.enum(["faulty", "as_shipped", "doa_confirmed"]),
    batteryHealth: z.number().int().min(50).max(100).optional(),
    notes: optionalText(500),
  })
  .strict();

export const ResolveReturnInput = z
  .object({
    returnId: id,
    outcome: z.enum(["faulty", "as_shipped", "doa_confirmed", "doa_replacement", "changed_mind"]),
    replacementListingId: id.optional(),
  })
  .strict();

export const AdvanceShipmentInput = z.object({ orderId: id }).strict();

// --- views ------------------------------------------------------------------

export const ListingCard = z.object({
  listingId: z.string(),
  brand: z.string(),
  model: z.string(),
  storage: z.string(),
  category: CATEGORY,
  colour: z.string().nullable(),
  grade: GRADE,
  batteryHealth: z.number().nullable(),
  price: Money,
  basePrice: Money,
  stepped: z.boolean(),
  warrantyMonths: z.number(),
  hubCity: z.string(),
  imageUrl: z.string().nullable(),
});
export type ListingCardT = z.infer<typeof ListingCard>;

export const ShopCatalogueView = z.object({
  items: z.array(ListingCard),
  total: z.number(),
  facets: z.object({
    brands: z.array(z.string()),
    storages: z.array(z.string()),
    categories: z.array(CATEGORY),
  }),
});

export const ShopHomeView = z.object({
  newest: z.array(ListingCard),
  gradeA: z.array(ListingCard),
  listedCount: z.number(),
});

export const ListingDetailView = z.object({
  card: ListingCard,
  available: z.boolean(),
  photos: z.array(z.object({ label: z.string(), url: z.string() })),
  inspection: z
    .object({
      checklist: z.array(z.object({ label: z.string(), result: z.string() })),
      batteryHealth: z.number().nullable(),
      cosmeticGrade: GRADE.nullable(),
      componentGrades: z.record(z.string(), GRADE).nullable(),
      inspectedOn: z.string().nullable(),
      hubName: z.string(),
    })
    .nullable(),
  priceHistory: z.object({
    basePrice: Money,
    currentPrice: Money,
    ladderStep: z.number(),
    listedAt: z.string(),
  }),
  addonPrice: Money,
  addonAvailable: z.boolean(),
  returnWindowDays: z.number(),
});

export const CartView = z.object({
  items: z.array(
    z.object({
      listingId: z.string(),
      available: z.boolean(),
      reason: z.string().nullable(),
      card: ListingCard.nullable(),
      addonPrice: Money,
      addonAvailable: z.boolean(),
    }),
  ),
  delivery: z.object({ name: z.string(), phone: z.string(), address: z.string() }),
  returnWindowDays: z.number(),
});

export const OrderSummary = z.object({
  orderId: z.string(),
  orderNo: z.string(),
  device: z.string(),
  grade: GRADE,
  status: z.string(),
  escrowStatus: z.string().nullable(),
  total: Money,
  placedAt: z.string(),
  nextAction: z.string().nullable(),
});

export const PlaceOrdersOutput = z.object({
  declined: z.boolean(),
  total: Money,
  orders: z.array(z.object({ orderId: z.string(), listingId: z.string(), total: Money })),
  removed: z.array(z.object({ listingId: z.string(), reason: z.string() })),
});

export const MyOrdersView = z.object({ items: z.array(OrderSummary) });

export const ConfirmationView = z.object({
  orders: z.array(
    OrderSummary.extend({
      devicePrice: Money,
      warrantyAddonAmount: Money,
      deliveryName: z.string(),
      deliveryAddress: z.string(),
      paymentMethod: z.string(),
    }),
  ),
  returnWindowDays: z.number(),
});

export const OrderTrackingView = z.object({
  summary: OrderSummary,
  amounts: z.object({ devicePrice: Money, warrantyAddonAmount: Money, total: Money }),
  delivery: z.object({ name: z.string(), phone: z.string(), address: z.string() }),
  paymentMethod: z.string(),
  timeline: z.array(z.object({ label: z.string(), at: z.string() })),
  returnWindowClosesAt: z.string().nullable(),
  canCancel: z.boolean(),
  cancelRefund: Money,
  canReturn: z.boolean(),
  refund: z.object({ amount: Money, at: z.string().nullable() }).nullable(),
  openReturn: z
    .object({
      returnId: z.string(),
      reason: z.string(),
      status: z.string(),
      recommendation: z.string().nullable(),
      outcome: z.string().nullable(),
      refund: Money.nullable(),
      deduction: Money.nullable(),
    })
    .nullable(),
  replacement: z.object({ device: z.string(), grade: GRADE, stage: z.string() }).nullable(),
  canAdvanceShipment: z.boolean(),
});

export const ReturnOptionsView = z.object({
  orderNo: z.string(),
  device: z.string(),
  eligible: z.boolean(),
  reason: z.string().nullable(),
  closesAt: z.string().nullable(),
  options: z.array(
    z.object({
      reason: z.enum(["not_as_graded", "dead_on_arrival", "buyer_changed_mind"]),
      label: z.string(),
      original: Money,
      deduction: Money,
      refund: Money,
    }),
  ),
  replacementAllowed: z.boolean(),
});

// --- staff views ------------------------------------------------------------

export const ReturnJobView = z.object({
  returnId: z.string(),
  status: z.string(),
  hubId: z.string(),
  device: z.string(),
  grade: GRADE,
  tagId: z.string(),
  reason: z.string(),
  note: z.string().nullable(),
  doaPreference: z.string().nullable(),
  recommendation: z.string().nullable(),
  raisedOn: z.string(),
});

export const OpsOrdersView = z.object({
  orders: z.array(
    z.object({
      orderId: z.string(),
      orderNo: z.string(),
      device: z.string(),
      buyer: z.string(),
      status: z.string(),
      next: z.string().nullable(),
    }),
  ),
});

export const OpsReturnsView = z.object({
  returns: z.array(
    z.object({
      returnId: z.string(),
      orderNo: z.string(),
      device: z.string(),
      grade: GRADE,
      reason: z.string(),
      note: z.string().nullable(),
      doaPreference: z.string().nullable(),
      status: z.string(),
      recommendation: z.string().nullable(),
      outcomes: z.array(
        z.object({ outcome: z.string(), refund: Money, deduction: Money, available: z.boolean() }),
      ),
      replacement: z
        .object({ listingId: z.string(), device: z.string(), grade: GRADE, price: Money })
        .nullable(),
    }),
  ),
});

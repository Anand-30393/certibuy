// Seller journey contracts (S-01 … S-14): shot lists, diagnostics, command inputs, view outputs.
import { z } from "zod";

export const GRADE = z.enum(["A", "B", "C", "D"]);
export const CATEGORY = z.enum(["phone", "laptop", "tablet", "watch"]);
export const REPAIRED = z.enum(["no", "authorised", "other_shop", "not_sure"]);
export const BILL_BOX = z.enum(["bill_and_box", "bill_only", "box_only", "neither"]);
export const WARRANTY_STATUS = z.enum(["in_warranty", "expired", "unknown"]);
export const PAYOUT_OPTION = z.enum(["instant_cash", "sell_for_more"]);

/** Guided photo shots (S-04): 8 for phones, 5 for other categories. */
export const PHOTO_SHOTS = {
  phone: [
    { key: "front", label: "Front, screen off", tip: "Lay the phone flat on a plain surface." },
    { key: "back", label: "Back", tip: "Show the whole back panel and camera bump." },
    { key: "left", label: "Left edge", tip: "Include the buttons." },
    { key: "right", label: "Right edge", tip: "Include the buttons." },
    { key: "top", label: "Top edge", tip: "Hold it upright against a plain wall." },
    { key: "bottom", label: "Bottom edge", tip: "Show the charging port." },
    { key: "screen_on", label: "Screen on", tip: "Open a white page at full brightness." },
    { key: "imei_label", label: "IMEI screen", tip: "Dial *#06# and photograph the IMEI." },
  ],
  other: [
    { key: "front", label: "Front", tip: "Lay the device flat on a plain surface." },
    { key: "back", label: "Back", tip: "Show the whole back or base." },
    { key: "sides", label: "Sides and ports", tip: "Show the edges and every port." },
    { key: "screen_on", label: "Screen on", tip: "Open a white page at full brightness." },
    {
      key: "serial_label",
      label: "Serial number",
      tip: "Photograph the serial label or settings page.",
    },
  ],
} as const;

export function shotsFor(category: z.infer<typeof CATEGORY>) {
  return category === "phone" ? PHOTO_SHOTS.phone : PHOTO_SHOTS.other;
}

/** The 9 diagnostic checks (S-05). Activation lock and IMEI/blacklist are reject gates. */
export const DIAGNOSTIC_CHECKS = [
  { key: "battery", label: "Battery holds charge" },
  { key: "screen_touch", label: "Screen and touch" },
  { key: "speakers", label: "Speakers" },
  { key: "microphone", label: "Microphone" },
  { key: "cameras", label: "Cameras" },
  { key: "charging", label: "Charging port" },
  { key: "sensors", label: "Sensors (proximity, motion)" },
  { key: "imei_blacklist", label: "IMEI not reported lost or stolen" },
  { key: "activation_lock", label: "Activation lock off (Find My / Google account)" },
] as const;
export type DiagnosticKey = (typeof DIAGNOSTIC_CHECKS)[number]["key"];
/** Checks that feed the function grade (the other two are reject gates). */
export const FUNCTION_CHECKS: readonly DiagnosticKey[] = [
  "battery",
  "screen_touch",
  "speakers",
  "microphone",
  "cameras",
  "charging",
  "sensors",
];

const PassFail = z.enum(["pass", "fail"]);
const id = z.string().min(1).max(64);

// --- commands ---------------------------------------------------------------

export const CreateSubmissionInput = z.object({ deviceModelId: id }).strict();

export const SaveDetailsInput = z
  .object({
    submissionId: id,
    colour: z.string().min(1).max(40),
    imei: z.string().regex(/^\d{15}$/, "Enter the 15-digit IMEI."),
    ageMonths: z.number().int().min(0).max(120),
    declaredCosmetic: GRADE,
    repaired: REPAIRED,
    waterExposure: z.boolean(),
    billBox: BILL_BOX,
    warrantyStatus: WARRANTY_STATUS,
  })
  .strict();

export const RequestPhotoUploadInput = z
  .object({ submissionId: id, key: z.string().min(1).max(32) })
  .strict();

export const ConfirmPhotoInput = z
  .object({
    submissionId: id,
    key: z.string().min(1).max(32),
    path: z.string().min(1).max(300),
    brightness: z.number().min(0).max(255),
    /** Shots the browser quality check rejected before this one was accepted. */
    failedAttempts: z.number().int().min(0).max(20),
  })
  .strict();

export const SaveDiagnosticsInput = z
  .object({
    submissionId: id,
    checks: z.record(z.string(), PassFail),
    batteryHealth: z.number().int().min(50).max(100),
  })
  .strict();

export const SubmissionIdInput = z.object({ submissionId: id }).strict();

export const AcceptOfferInput = z
  .object({ submissionId: id, option: PAYOUT_OPTION, consent: z.literal(true) })
  .strict();

export const BookInspectionInput = z
  .object({
    submissionId: id,
    hubId: id,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    slot: z.string().regex(/^\d{2}:\d{2}$/),
  })
  .strict();

export const ManageBookingInput = z
  .object({ submissionId: id, action: z.enum(["switch_to_guaranteed", "cancel"]) })
  .strict();

export const UpdateProfileInput = z
  .object({
    fullName: z.string().trim().min(2).max(80),
    phone: z
      .string()
      .trim()
      .regex(/^(\+?91)?[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number.")
      .or(z.literal("")),
    city: z.string().trim().max(60),
    payoutAccount: z.string().trim().max(80),
    deliveryAddress: z.string().trim().max(300),
  })
  .strict();

// --- view outputs -----------------------------------------------------------

const Money = z.number().int();

export const OfferView = z.object({
  id: z.string(),
  version: z.number(),
  band: z.array(GRADE),
  guaranteedPrice: Money,
  instantCashAmount: Money.nullable(),
  icEligible: z.boolean(),
  icReason: z.string().nullable(),
  icReasonLabel: z.string().nullable(),
  riskPct: z.number(),
  riskTier: z.string(),
  breakdown: z.object({
    market: Money,
    commission: Money,
    commissionPct: z.number(),
    inspectionFee: Money,
    risk: Money,
  }),
  advance: Money,
  balance: Money,
  balanceDay: z.number(),
  expiresAt: z.string(),
  status: z.string(),
});

export const AssessmentView = z.object({
  estimate: GRADE,
  band: z.array(GRADE),
  confidence: z.enum(["High", "Medium", "Low"]),
  confidenceValue: z.number(),
  factors: z.array(z.string()),
  valueRange: z.object({ low: Money, high: Money }),
});

export const PhotoView = z.object({
  key: z.string(),
  label: z.string(),
  tip: z.string(),
  uploaded: z.boolean(),
  url: z.string().nullable(),
});

export const BookingView = z.object({
  id: z.string(),
  hubId: z.string(),
  hubName: z.string(),
  hubAddress: z.string(),
  date: z.string(),
  slot: z.string(),
  status: z.string(),
});

export const HubOptionView = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  address: z.string(),
  city: z.string(),
  distanceKm: z.number().nullable(),
  days: z.array(
    z.object({
      date: z.string(),
      remaining: z.number(),
      slots: z.array(z.string()),
    }),
  ),
});

export const SubmissionView = z.object({
  id: z.string(),
  status: z.string(),
  rejectReason: z.string().nullable(),
  model: z.object({
    id: z.string(),
    brand: z.string(),
    model: z.string(),
    storage: z.string(),
    category: CATEGORY,
    colours: z.array(z.string()),
  }),
  details: z.object({
    colour: z.string().nullable(),
    imei: z.string().nullable(),
    ageMonths: z.number().nullable(),
    declaredCosmetic: GRADE.nullable(),
    repaired: REPAIRED.nullable(),
    waterExposure: z.boolean().nullable(),
    billBox: BILL_BOX.nullable(),
    warrantyStatus: WARRANTY_STATUS.nullable(),
  }),
  photos: z.array(PhotoView),
  retakeCount: z.number(),
  diagnostics: z.object({
    checks: z.record(z.string(), z.string()),
    batteryHealth: z.number().nullable(),
  }),
  assessment: AssessmentView.nullable(),
  offer: OfferView.nullable(),
  chosenOption: PAYOUT_OPTION.nullable(),
  booking: BookingView.nullable(),
  inspection: z
    .object({
      finalGrade: GRADE.nullable(),
      verdict: z.enum(["inside", "one_below", "two_below"]).nullable(),
      quoted: Money.nullable(),
      revised: Money.nullable(),
      sellerDecision: z.string().nullable(),
    })
    .nullable(),
  hubs: z.array(HubOptionView),
  nextStep: z.string(),
  businessDate: z.string(),
  photoRules: z.object({ minPx: z.number(), minBrightness: z.number() }),
});
export type SubmissionViewT = z.infer<typeof SubmissionView>;

export const SellCatalogueView = z.object({
  models: z.array(
    z.object({
      id: z.string(),
      brand: z.string(),
      model: z.string(),
      storage: z.string(),
      category: CATEGORY,
      selectable: z.boolean(),
      reason: z.string().nullable(),
    }),
  ),
});

export const DealRowView = z.object({
  id: z.string(),
  device: z.string(),
  status: z.string(),
  nextAction: z.object({ label: z.string(), href: z.string() }).nullable(),
  amount: Money.nullable(),
  updated: z.string(),
});

export const SellerHomeView = z.object({ deals: z.array(DealRowView) });

export const PayoutRowView = z.object({
  id: z.string(),
  device: z.string(),
  type: z.string(),
  amount: Money,
  status: z.string(),
  trigger: z.string().nullable(),
  dueOn: z.string().nullable(),
  paidAt: z.string().nullable(),
  failureReason: z.string().nullable(),
});

export const SellerPayoutsView = z.object({
  payouts: z.array(PayoutRowView),
  totals: z.object({ paid: Money, pending: Money, due: Money }),
});

export const DealTrackerView = z.object({
  submission: SubmissionView,
  payouts: z.array(PayoutRowView),
  timeline: z.array(z.object({ at: z.string(), text: z.string() })),
});

export const ProfileView = z.object({
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string(),
  city: z.string(),
  payoutAccount: z.string(),
  deliveryAddress: z.string(),
  appRole: z.string(),
});

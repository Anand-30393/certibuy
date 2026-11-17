// Technician counter contracts (T-01 … T-07, S-14).
import { z } from "zod";
import { GRADE, PAYOUT_OPTION } from "./selling";

/** The technician's 9-item checklist (T-03). Failed count → function grade (1 B, 2 C, 3+ D). */
export const TECH_CHECKLIST = [
  { key: "screen", label: "Display: no dead pixels, lines or burn-in" },
  { key: "touch", label: "Touch responds across the whole screen" },
  { key: "speakers", label: "Speakers (earpiece and loudspeaker)" },
  { key: "microphone", label: "Microphone records clearly" },
  { key: "cameras", label: "Front and rear cameras focus and capture" },
  { key: "charging", label: "Charges by cable" },
  { key: "buttons", label: "Buttons and switches" },
  { key: "sensors", label: "Proximity, motion and biometric sensors" },
  { key: "connectivity", label: "SIM, Wi-Fi and Bluetooth" },
] as const;

export const REJECT_REASONS = {
  imei_mismatch: "The IMEI on the device doesn't match the one given when booking.",
  blacklisted: "This IMEI has been reported blacklisted, so we can't buy this device.",
  activation_lock_on: "Activation lock is still on, so the device can't be accepted today.",
  identity_failed: "We couldn't confirm the seller's identity at the counter.",
  unsafe_device: "The device isn't safe to accept (for example a swollen battery).",
} as const;
export type RejectReasonCode = keyof typeof REJECT_REASONS;

const id = z.string().min(1).max(64);
const PassFail = z.enum(["pass", "fail"]);

export const HubQueueInput = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    hubId: id.optional(),
  })
  .strict();

export const VerifyIdentityInput = z
  .object({
    submissionId: id,
    scannedImei: z.string().regex(/^\d{15}$/, "Scan or type the 15-digit IMEI."),
    activationLockOff: z.boolean(),
  })
  .strict();

export const ConfirmGradeInput = z
  .object({
    submissionId: id,
    checklist: z.record(z.string(), PassFail),
    batteryHealth: z.number().int().min(50).max(100),
    cosmeticGrade: GRADE,
  })
  .strict();

export const RejectForMismatchInput = z.object({ submissionId: id, feePaid: z.boolean() }).strict();

export const RejectDeviceInput = z
  .object({
    submissionId: id,
    reasonCode: z.enum(Object.keys(REJECT_REASONS) as [RejectReasonCode, ...RejectReasonCode[]]),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

export const RequestSignatureUploadInput = z.object({ submissionId: id }).strict();

export const CompleteHandoverInput = z
  .object({
    submissionId: id,
    sealed: z.literal(true),
    tagId: z.string().regex(/^CB-\d{5}$/, "Scan the custody tag (CB- followed by 5 digits)."),
    signaturePath: z.string().min(1).max(300),
  })
  .strict();

// --- views ------------------------------------------------------------------

export const InspectionSummaryView = z.object({
  identityPassed: z.boolean().nullable(),
  imeiMatch: z.boolean().nullable(),
  blacklistClear: z.boolean().nullable(),
  activationLockOff: z.boolean().nullable(),
  checklist: z.record(z.string(), z.string()),
  batteryHealth: z.number().nullable(),
  cosmeticGrade: GRADE.nullable(),
  componentGrades: z.record(z.string(), GRADE).nullable(),
  finalGrade: GRADE.nullable(),
  verdict: z.enum(["inside", "one_below", "two_below"]).nullable(),
  quoted: z.number().nullable(),
  revised: z.number().nullable(),
  sellerDecision: z.string().nullable(),
  sealed: z.boolean(),
  tagId: z.string().nullable(),
});

export const HubJobRow = z.object({
  submissionId: z.string(),
  bookingId: z.string(),
  slot: z.string(),
  date: z.string(),
  sellerName: z.string(),
  device: z.string(),
  aiBand: z.array(GRADE),
  confidence: z.string().nullable(),
  option: PAYOUT_OPTION.nullable(),
  status: z.string(),
  bookingStatus: z.string(),
});

export const HubQueueView = z.object({
  hub: z.object({ id: z.string(), name: z.string(), city: z.string() }).nullable(),
  hubs: z.array(z.object({ id: z.string(), name: z.string() })),
  today: z.string(),
  date: z.string(),
  days: z.array(z.string()),
  jobs: z.array(HubJobRow),
});

export const HubJobView = z.object({
  submissionId: z.string(),
  status: z.string(),
  rejectReason: z.string().nullable(),
  hub: z.object({ id: z.string(), name: z.string() }),
  booking: z.object({ date: z.string(), slot: z.string(), status: z.string() }),
  seller: z.object({ name: z.string(), phone: z.string().nullable() }),
  device: z.object({
    brand: z.string(),
    model: z.string(),
    storage: z.string(),
    category: z.string(),
    colour: z.string().nullable(),
    declaredImeiLast4: z.string().nullable(),
  }),
  ai: z.object({
    band: z.array(GRADE),
    estimate: GRADE.nullable(),
    confidence: z.string().nullable(),
  }),
  option: PAYOUT_OPTION.nullable(),
  agreedAmount: z.number().nullable(),
  inspection: InspectionSummaryView.nullable(),
  handover: z
    .object({
      deviceId: z.string(),
      tagId: z.string(),
      listingId: z.string().nullable(),
      listingPrice: z.number().nullable(),
      warrantyMonths: z.number().nullable(),
      paid: z.number(),
      payoutStatus: z.string(),
    })
    .nullable(),
  nextStep: z.enum(["identity", "checklist", "decision", "handover", "done", "closed"]),
  mismatchFee: z.number(),
});
export type HubJobViewT = z.infer<typeof HubJobView>;

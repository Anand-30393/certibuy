// Jobs (O-12), demo controls (O-11), mail log (O-15) and notifications (X-04).
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const DailyCounts = z.object({
  stepped: z.number(),
  reviewed: z.number(),
  reservedUpdated: z.number(),
  balances: z.number(),
  payoutsPaid: z.number(),
  payoutsFailed: z.number(),
  settled: z.number(),
  expiredOffers: z.number(),
  noShows: z.number(),
  reminders: z.number(),
  emailsSent: z.number(),
});
export type DailyCountsT = z.infer<typeof DailyCounts>;

export const RunDailyJobsInput = z.object({ businessDate: isoDate.optional() }).strict();
export const RunDailyJobsOutput = z.object({
  ok: z.literal(true),
  businessDate: z.string(),
  done: z.boolean(),
  counts: DailyCounts,
});

export const AdvanceDemoClockInput = z.object({ days: z.number().int().min(1).max(30) }).strict();
export const AdvanceDemoClockOutput = RunDailyJobsOutput.extend({ simDayOffset: z.number() });

export const SetDemoSettingsInput = z
  .object({
    simulatePayoutFailure: z.boolean().optional(),
    /** Demo only: move the business clock back to the real date. */
    resetClock: z.literal(true).optional(),
  })
  .strict();

export const JobResultOutput = z.object({
  ok: z.literal(true),
  counts: z.record(z.string(), z.number()),
});

export const RetryPayoutInput = z.object({ payoutId: z.string().min(1).max(64) }).strict();

export const JobsBoardView = z.object({
  businessDate: z.string(),
  realDate: z.string(),
  simDayOffset: z.number(),
  demoMode: z.boolean(),
  demoToolsEnabled: z.boolean(),
  simulatePayoutFailure: z.boolean(),
  dailyRanToday: z.boolean(),
  runs: z.array(
    z.object({
      job: z.string(),
      businessDate: z.string(),
      status: z.string(),
      startedAt: z.string(),
      finishedAt: z.string().nullable(),
      counts: z.record(z.string(), z.number()),
    }),
  ),
  pendingEmails: z.number(),
  heldPayouts: z.array(
    z.object({
      payoutId: z.string(),
      type: z.string(),
      amount: z.number(),
      attempts: z.number(),
      reason: z.string().nullable(),
    }),
  ),
});

export const MailLogView = z.object({
  messages: z.array(
    z.object({
      id: z.string(),
      to: z.string(),
      event: z.string(),
      subject: z.string(),
      body: z.string(),
      status: z.string(),
      createdAt: z.string(),
      sentAt: z.string().nullable(),
    }),
  ),
});

export const NotificationsInput = z
  .object({
    unread: z.enum(["1"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const NotificationsView = z.object({
  unreadCount: z.number(),
  items: z.array(
    z.object({
      id: z.string(),
      event: z.string(),
      title: z.string(),
      body: z.string(),
      link: z.string(),
      read: z.boolean(),
      createdAt: z.string(),
    }),
  ),
});

export const MarkNotificationsReadInput = z
  .object({
    ids: z.array(z.string().min(1).max(64)).max(100).optional(),
    all: z.literal(true).optional(),
  })
  .strict();

// Shared write helpers used inside command transactions: notify() and the activity log.
// notify() is the only place that writes notifications and queues transactional email
// (docs/notifications.md.txt §6). Email is simulated in the capstone: rows wait in `outbox`.
import type { Prisma } from "@certibuy/db";
import { fromIsoDate } from "@certibuy/db";
import type { Actor } from "./actor";

export type Tx = Prisma.TransactionClient;

export const EMAIL_EVENTS = new Set([
  "offer_ready",
  "offer_expiring",
  "booking_confirmed",
  "custody_complete",
  "inspection_rejected",
  "balance_paid",
  "payout_failed",
  "order_placed",
  "order_cancelled",
  "order_dispatched",
  "order_delivered",
  "return_window_closing",
  "return_resolved",
  "escrow_released",
]);

export interface NotificationRow {
  userId: string;
  event: string;
  title: string;
  body: string;
  link: string;
  /** Only for deduplicated reminders (offer_expiring, return_window_closing). */
  dedupeKey?: string;
}

export async function notify(tx: Tx, rows: NotificationRow[], appPublicUrl: string): Promise<void> {
  for (const row of rows) {
    await tx.notification.create({
      data: {
        user_id: row.userId,
        event: row.event,
        title: row.title.slice(0, 60),
        body: row.body.slice(0, 180),
        link: row.link,
        dedupe_key: row.dedupeKey ?? null,
      },
    });
    if (!EMAIL_EVENTS.has(row.event)) continue;
    const user = await tx.profile.findUnique({
      where: { id: row.userId },
      select: { email: true },
    });
    if (!user?.email) continue;
    await tx.outbox.create({
      data: {
        user_id: row.userId,
        to_email: user.email,
        event: row.event,
        subject: row.title,
        body: `${row.body}\n\n${appPublicUrl}${row.link}\n\n— CertiBuy`,
      },
    });
  }
}

export async function logActivity(
  tx: Tx,
  entry: {
    actor: Actor | null;
    text: string;
    entity: string;
    entityId: string;
    businessDate: string;
  },
): Promise<void> {
  await tx.activityLog.create({
    data: {
      actor_id: entry.actor?.userId ?? null,
      actor_name: entry.actor?.fullName || entry.actor?.email || "System",
      text: entry.text,
      entity: entry.entity,
      entity_id: entry.entityId,
      business_date: fromIsoDate(entry.businessDate),
    },
  });
}

/** Serialise competing writers on one key for the rest of the transaction. */
export async function lockKey(tx: Tx, key: string): Promise<void> {
  // $executeRaw: the lock function returns void, which $queryRaw cannot deserialise.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

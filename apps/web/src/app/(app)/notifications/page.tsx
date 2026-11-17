// X-04: notification list with an unread filter.
import type { NotificationsView } from "@certibuy/contracts";
import Link from "next/link";
import type { z } from "zod";
import { EmptyPanel, formatDate } from "@/components/common/ui";
import OpsCommandButton from "@/components/ops/OpsCommandButton";
import { loadView } from "@/server/views";

export default async function NotificationsPage(props: {
  searchParams: Promise<{ unread?: string }>;
}) {
  const { unread } = await props.searchParams;
  const data = await loadView<z.infer<typeof NotificationsView>>("getNotifications", {
    limit: "100",
    ...(unread === "1" ? { unread: "1" } : {}),
  });
  return (
    <section className="stack narrow">
      <h1>Notifications</h1>
      <div className="row">
        <Link
          href="/notifications"
          className="pill"
          aria-current={unread !== "1" ? "page" : undefined}
        >
          All
        </Link>
        <Link
          href="/notifications?unread=1"
          className="pill"
          aria-current={unread === "1" ? "page" : undefined}
        >
          Unread ({data.unreadCount})
        </Link>
        {data.unreadCount > 0 && (
          <OpsCommandButton
            name="markNotificationsRead"
            body={{ all: true }}
            label="Mark all read"
          />
        )}
      </div>
      {data.items.length === 0 ? (
        <EmptyPanel title="You're all caught up" />
      ) : (
        <ul className="list">
          {data.items.map((n) => (
            <li key={n.id} className={`surface list-row${n.read ? "" : " unread-row"}`}>
              <div>
                <p className="field-label">{n.title}</p>
                <p className="meta">{n.body}</p>
              </div>
              <span className="meta">{formatDate(n.createdAt)}</span>
              {n.link && <Link href={n.link}>Open</Link>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

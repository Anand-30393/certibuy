"use client";

// X-04 bell: unread count from the server (not a counted page), latest 10 in a dropdown,
// refreshed every 60 seconds. Opening a notification marks it read and follows its link.
import type { NotificationsView } from "@certibuy/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { command } from "@/lib/api";

type Data = z.infer<typeof NotificationsView>;

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

export default function NotificationBell() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/v1/views/getNotifications?limit=10").catch(() => null);
    if (r?.ok) setData((await r.json()) as Data);
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  async function openItem(id: string, link: string, read: boolean) {
    setOpen(false);
    if (!read) await command("markNotificationsRead", { ids: [id] }).catch(() => null);
    void load();
    if (link) router.push(link);
  }

  async function markAll() {
    await command("markNotificationsRead", { all: true }).catch(() => null);
    void load();
  }

  const unread = data?.unreadCount ?? 0;
  return (
    <div className="bell" ref={box}>
      <button
        type="button"
        className="link-button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Notifications, ${unread} unread`}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void load();
        }}
      >
        Notifications{unread > 0 && <span className="badge">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="bell-menu surface" role="menu">
          <div className="row">
            <span className="field-label">Notifications</span>
            {unread > 0 && (
              <button type="button" className="link-button" onClick={markAll}>
                Mark all read
              </button>
            )}
          </div>
          {!data || data.items.length === 0 ? (
            <p className="meta">You&apos;re all caught up.</p>
          ) : (
            <ul className="bell-list">
              {data.items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    role="menuitem"
                    className={`bell-item${n.read ? "" : " unread"}`}
                    onClick={() => openItem(n.id, n.link, n.read)}
                  >
                    <span className="field-label">{n.title}</span>
                    <span className="meta">{n.body}</span>
                    <span className="meta">{ago(n.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link href="/notifications" onClick={() => setOpen(false)}>
            See all
          </Link>
        </div>
      )}
    </div>
  );
}

// O-15: every email the system would send (simulated — nothing leaves the system).
import type { MailLogView } from "@certibuy/contracts";
import Link from "next/link";
import type { z } from "zod";
import { EmptyPanel, formatDate } from "@/components/common/ui";
import { loadView } from "@/server/views";

export default async function MailLogPage() {
  const { messages } = await loadView<z.infer<typeof MailLogView>>("getMailLog");
  return (
    <section className="stack">
      <Link href="/ops">← Operations</Link>
      <h1>Mail log</h1>
      <p className="meta">
        Email is simulated in this demo: messages are recorded here instead of being sent.
      </p>
      {messages.length === 0 ? (
        <EmptyPanel title="No emails yet" />
      ) : (
        <ul className="list">
          {messages.map((m) => (
            <li key={m.id} className="surface panel stack">
              <p className="row">
                <span className="field-label">{m.subject}</span>
                <span
                  className={`chip ${m.status === "sent" ? "tone-success" : m.status === "failed" ? "tone-danger" : "tone-warning"}`}
                >
                  {m.status === "sent"
                    ? "Sent (simulated)"
                    : m.status === "failed"
                      ? "Failed"
                      : "Queued"}
                </span>
              </p>
              <p className="meta">
                To {m.to} · {m.event} · {formatDate(m.createdAt)}
              </p>
              <pre className="mail-body">{m.body}</pre>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

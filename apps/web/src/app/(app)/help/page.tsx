// X-05 help: customers ask customer care about a deal, order, return or payment.
import type { MySupportView } from "@certibuy/application";
import Link from "next/link";
import type { z } from "zod";
import { EmptyPanel, StatusChip } from "@/components/common/ui";
import CommandForm from "@/components/ops/CommandForm";
import { getActor } from "@/server/actor";
import { loadView } from "@/server/views";

const TOPICS = [
  { value: "selling_device", label: "Selling a device" },
  { value: "order_delivery", label: "Order or delivery" },
  { value: "return_refund", label: "Return or refund" },
  { value: "payments", label: "Payments" },
  { value: "other", label: "Something else" },
];

export default async function HelpPage() {
  const actor = await getActor();
  if (actor && actor.appRole !== "customer" && !actor.isPlatformAdmin) {
    return (
      <section className="stack">
        <h1>Help</h1>
        <p>
          Staff questions go to your operations lead. Customer requests arrive in the{" "}
          <Link href="/ops/support">support inbox</Link>.
        </p>
      </section>
    );
  }
  const { items, targets } = await loadView<z.infer<typeof MySupportView>>("getMySupport");
  return (
    <section className="stack">
      <h1>Help</h1>
      <div className="surface panel stack">
        <h2>Ask customer care</h2>
        <p className="meta">
          We reply within one working day. You&apos;ll get a notification when we do.
        </p>
        <CommandForm
          name="submitSupportRequest"
          fields={[
            { name: "topic", label: "Topic", kind: "select", options: TOPICS },
            {
              name: "relatedId",
              label: "Which deal or order (optional)",
              kind: "select",
              nullable: false,
              optional: true,
              options: [
                { value: "", label: "Not about a specific one" },
                ...targets.map((t) => ({ value: t.id, label: t.label })),
              ],
            },
            { name: "message", label: "Your message", kind: "textarea", required: true },
          ]}
          submitLabel="Send"
        />
      </div>
      <h2>Your requests</h2>
      {items.length === 0 ? (
        <EmptyPanel title="No requests yet" />
      ) : (
        items.map((r) => (
          <div key={r.id} className="surface panel stack">
            <div className="row">
              <StatusChip group="support_topic" value={r.topic} />
              <StatusChip group="case_status" value={r.status} />
              <span className="meta">
                {new Date(r.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
              </span>
            </div>
            <p>{r.message}</p>
            {r.reply ? (
              <p className="notice">Customer care: {r.reply}</p>
            ) : (
              <p className="meta">Waiting for a reply.</p>
            )}
          </div>
        ))
      )}
    </section>
  );
}

// O-13 support inbox: reply (notifies the customer) and resolve.
import type { SupportInboxView } from "@certibuy/application";
import Link from "next/link";
import type { z } from "zod";
import { EmptyPanel, StatusChip } from "@/components/common/ui";
import CommandForm from "@/components/ops/CommandForm";
import OpsCommandButton from "@/components/ops/OpsCommandButton";
import { loadView } from "@/server/views";

export default async function SupportInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const resolved = (await searchParams).status === "resolved";
  const { items } = await loadView<z.infer<typeof SupportInboxView>>("getSupportInbox", {
    status: resolved ? "resolved" : "open",
  });
  return (
    <section className="stack">
      <h1>Support inbox</h1>
      <nav aria-label="Filter" className="filter-row">
        <Link href="/ops/support" aria-current={resolved ? undefined : "page"}>
          Open
        </Link>
        <Link href="/ops/support?status=resolved" aria-current={resolved ? "page" : undefined}>
          Resolved
        </Link>
      </nav>
      {items.length === 0 ? (
        <EmptyPanel title={resolved ? "No resolved requests" : "The inbox is empty"} />
      ) : (
        items.map((r) => (
          <div key={r.id} className="surface panel stack">
            <div className="row">
              <span className="field-label">{r.customer}</span>
              <StatusChip group="support_topic" value={r.topic} />
              <StatusChip group="case_status" value={r.status} />
              <span className="meta">
                {new Date(r.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
              </span>
            </div>
            <p>{r.message}</p>
            {r.relatedId && (
              <p className="meta">About record {r.relatedId.slice(-8).toUpperCase()}</p>
            )}
            {r.reply && <p className="meta">Our reply: {r.reply}</p>}
            {r.status === "open" && (
              <>
                <CommandForm
                  name="replySupportRequest"
                  fixed={{ requestId: r.id }}
                  fields={[
                    { name: "reply", label: "Reply", kind: "textarea", required: true },
                    {
                      name: "resolve",
                      label: "Resolve after replying",
                      kind: "checkbox",
                      defaultValue: true,
                    },
                  ]}
                  submitLabel="Send reply"
                />
                <OpsCommandButton
                  name="resolveSupportRequest"
                  body={{ requestId: r.id }}
                  label="Resolve without reply"
                />
              </>
            )}
          </div>
        ))
      )}
    </section>
  );
}

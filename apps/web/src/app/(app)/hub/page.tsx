// T-01: hub queue.
import type { HubQueueView } from "@certibuy/contracts";
import Link from "next/link";
import type { z } from "zod";
import { EmptyPanel, formatDate, GradeChip, StatusChip } from "@/components/common/ui";
import { loadView } from "@/server/views";

export default async function HubQueuePage(props: {
  searchParams: Promise<{ date?: string; hubId?: string }>;
}) {
  const sp = await props.searchParams;
  const q = await loadView<z.infer<typeof HubQueueView>>("getHubQueue", {
    ...(sp.date ? { date: sp.date } : {}),
    ...(sp.hubId ? { hubId: sp.hubId } : {}),
  });
  const qs = (over: Record<string, string>) =>
    `/hub?${new URLSearchParams({ ...(q.hub ? { hubId: q.hub.id } : {}), date: q.date, ...over })}`;

  if (!q.hub) {
    return (
      <EmptyPanel title="No hub assigned">
        <p>Ask operations to assign you to a hub.</p>
      </EmptyPanel>
    );
  }

  return (
    <section className="stack">
      <div className="row">
        <h1>
          {q.hub.name}, {q.hub.city}
        </h1>
      </div>
      {q.hubs.length > 1 && (
        <nav className="chip-row" aria-label="Hub">
          {q.hubs.map((h) => (
            <Link
              key={h.id}
              href={qs({ hubId: h.id })}
              className="pill"
              aria-current={h.id === q.hub?.id ? "page" : undefined}
            >
              {h.name}
            </Link>
          ))}
        </nav>
      )}
      <nav className="chip-row" aria-label="Day">
        {q.days.map((d) => (
          <Link
            key={d}
            href={qs({ date: d })}
            className="pill"
            aria-current={d === q.date ? "page" : undefined}
          >
            {d === q.today ? "Today" : formatDate(d)}
          </Link>
        ))}
      </nav>
      {q.returns.length > 0 && (
        <div className="surface panel stack">
          <h2>Return re-inspections</h2>
          <ul className="list">
            {q.returns.map((r) => (
              <li key={r.returnId} className="list-row">
                <span>
                  {r.device} · <StatusChip group="return_reason" value={r.reason} />
                </span>
                <Link href={`/hub/returns/${r.returnId}`} className="button">
                  Re-inspect
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {q.jobs.length === 0 ? (
        <EmptyPanel title={`No bookings for ${formatDate(q.date)}`}>
          <p>Pick another day above.</p>
        </EmptyPanel>
      ) : (
        <ul className="list">
          {q.jobs.map((j) => (
            <li key={j.bookingId} className="surface list-row">
              <div>
                <p className="field-label">
                  {j.slot} · {j.device}
                </p>
                <p className="meta">{j.sellerName}</p>
              </div>
              <div className="row">
                {j.aiBand.map((g) => (
                  <GradeChip key={g} grade={g} />
                ))}
                {j.confidence && <StatusChip group="confidence" value={j.confidence} />}
              </div>
              <StatusChip group="submission" value={j.status} />
              <Link href={`/hub/${j.submissionId}`} className="button">
                Open
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

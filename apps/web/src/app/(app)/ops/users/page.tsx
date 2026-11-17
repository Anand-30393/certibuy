// O-09 users and staff invitations. Changing access is platform-admin only (checked on the server).
import type { UsersBoardView } from "@certibuy/application";
import type { z } from "zod";
import { EmptyPanel, StatusChip } from "@/components/common/ui";
import CommandForm from "@/components/ops/CommandForm";
import { loadView } from "@/server/views";

const ROLES = [
  { value: "customer", label: "Customer" },
  { value: "technician", label: "Technician" },
  { value: "ops", label: "Operations" },
];

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const b = await loadView<z.infer<typeof UsersBoardView>>(
    "getUsersBoard",
    q ? { q: q.slice(0, 60) } : {},
  );
  const hubOptions = b.hubs.map((h) => ({ value: h.id, label: h.name }));
  return (
    <section className="stack">
      <h1>Users</h1>
      {!b.canManage && (
        <p className="notice">Only a platform admin can change roles or invite staff.</p>
      )}
      {b.canManage && (
        <details className="surface panel">
          <summary className="field-label">Invite staff</summary>
          <CommandForm
            name="inviteStaff"
            fields={[
              { name: "email", label: "Email", kind: "text", required: true },
              { name: "appRole", label: "Role", kind: "select", options: ROLES.slice(1) },
              {
                name: "hubId",
                label: "Hub (technicians)",
                kind: "select",
                nullable: true,
                options: hubOptions,
              },
            ]}
            submitLabel="Create invitation link"
            resultKey="link"
          />
        </details>
      )}
      {b.invitations.length > 0 && (
        <ul className="list">
          {b.invitations.map((i) => (
            <li key={i.id} className="list-row">
              <span>
                {i.email} · {i.appRole}
              </span>
              <StatusChip group="invitation" value={i.status} />
            </li>
          ))}
        </ul>
      )}
      <form className="row" role="search">
        <label className="field">
          <span className="field-label">Search name or email</span>
          <input name="q" defaultValue={q ?? ""} />
        </label>
        <button className="button" type="submit">
          Search
        </button>
      </form>
      {b.users.length === 0 ? (
        <EmptyPanel title="No users match" />
      ) : (
        b.users.map((u) => (
          <details key={u.id} className="surface panel">
            <summary>
              <span className="field-label">{u.name}</span>{" "}
              <span className="meta">
                {u.email} · <StatusChip group="app_role" value={u.appRole} />
                {u.isPlatformAdmin ? " · platform admin" : ""} · trust {u.trustScore} · returns{" "}
                {u.returnCount}
                {u.accountFlagged ? " · flagged" : ""}
              </span>
            </summary>
            {b.canManage ? (
              <CommandForm
                name="saveUserAccess"
                fixed={{ userId: u.id }}
                fields={[
                  {
                    name: "appRole",
                    label: "Role",
                    kind: "select",
                    options: ROLES,
                    defaultValue: u.appRole,
                  },
                  {
                    name: "hubId",
                    label: "Hub (technicians)",
                    kind: "select",
                    nullable: true,
                    options: hubOptions,
                    defaultValue: u.hubId,
                  },
                  {
                    name: "trustScore",
                    label: "Trust score",
                    kind: "number",
                    step: "1",
                    defaultValue: u.trustScore,
                  },
                  {
                    name: "accountFlagged",
                    label: "Flag account",
                    kind: "checkbox",
                    defaultValue: u.accountFlagged,
                  },
                ]}
                submitLabel="Save access"
              />
            ) : (
              <p className="meta">Read only.</p>
            )}
          </details>
        ))
      )}
    </section>
  );
}

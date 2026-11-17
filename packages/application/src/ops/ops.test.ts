// Ops console permissions (docs/roles.md.txt §2): every ops endpoint refuses customers and
// technicians before touching data; staff management is platform-admin only; invitations apply once.
import { describe, expect, it, vi } from "vitest";
import type { Actor } from "../actor";
import type { AppContext } from "../context";
import { commands, views } from "../handlers";
import { dispatch } from "../registry";
import { acceptPendingInvitation, opsCommands, opsViews } from "./handlers";

const actor = (over: Partial<Actor> = {}): Actor => ({
  userId: "u1",
  email: "u1@certibuy.test",
  fullName: "User One",
  appRole: "customer",
  activeMode: null,
  hubId: null,
  isPlatformAdmin: false,
  aal: "aal2",
  ...over,
});

// A db that fails loudly if a handler reaches it: proves the refusal happens first.
const untouchable = new Proxy(
  {},
  {
    get: () => {
      throw new Error("db touched");
    },
  },
) as AppContext["db"];

const ctx = (a: Actor): AppContext => ({
  db: untouchable,
  actor: a,
  now: new Date("2026-11-17T10:00:00Z"),
  storage: {} as AppContext["storage"],
  payouts: {} as AppContext["payouts"],
  mail: {} as AppContext["mail"],
  authAdmin: { inviteLink: vi.fn() },
  env: { requireStaffMfa: true, demoToolsEnabled: false, appPublicUrl: "http://localhost" },
});

const CUSTOMER_SUPPORT = new Set(["submitSupportRequest", "getMySupport"]);

describe("ops console access", () => {
  const staffOnly = [
    ...Object.keys(opsViews).map((n) => ["view", n] as const),
    ...Object.keys(opsCommands).map((n) => ["command", n] as const),
  ].filter(([, n]) => !CUSTOMER_SUPPORT.has(n));

  it.each(staffOnly)("%s %s refuses customers and technicians", async (kind, name) => {
    const registry = kind === "view" ? views : commands;
    for (const a of [actor(), actor({ appRole: "technician", hubId: "hub_1" })]) {
      await expect(dispatch(registry, name, ctx(a), {})).rejects.toMatchObject({ status: 403 });
    }
  });

  it("requires two-step verification for ops", async () => {
    await expect(
      dispatch(views, "getOpsOverview", ctx(actor({ appRole: "ops", aal: "aal1" })), {}),
    ).rejects.toMatchObject({ code: "mfa_required" });
  });

  it("keeps customer care requests to customers", async () => {
    const tech = actor({ appRole: "technician", hubId: "hub_1" });
    await expect(
      dispatch(commands, "submitSupportRequest", ctx(tech), {
        topic: "other",
        message: "Hello there, help",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(dispatch(views, "getMySupport", ctx(tech), {})).rejects.toMatchObject({
      status: 403,
    });
  });

  it("lets only a platform admin change roles or invite staff", async () => {
    const ops = actor({ appRole: "ops" });
    await expect(
      dispatch(commands, "saveUserAccess", ctx(ops), {
        userId: "u2",
        appRole: "ops",
        hubId: null,
        trustScore: 50,
        accountFlagged: false,
      }),
    ).rejects.toMatchObject({ code: "admin_only" });
    await expect(
      dispatch(commands, "inviteStaff", ctx(ops), {
        email: "new@certibuy.test",
        appRole: "ops",
        hubId: null,
      }),
    ).rejects.toMatchObject({ code: "admin_only" });
  });

  it("requires a hub for an invited technician", async () => {
    const admin = actor({ appRole: "ops", isPlatformAdmin: true });
    await expect(
      dispatch(commands, "inviteStaff", ctx(admin), {
        email: "tech@certibuy.test",
        appRole: "technician",
        hubId: null,
      }),
    ).rejects.toMatchObject({ code: "hub_required" });
  });

  it("validates money inputs before any write", async () => {
    const ops = actor({ appRole: "ops" });
    await expect(
      dispatch(commands, "setListingOverride", ctx(ops), {
        listingId: "l1",
        price: -5,
        reason: "test",
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      dispatch(commands, "setListingOverride", ctx(ops), {
        listingId: "l1",
        price: 1000.5,
        reason: "test",
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      dispatch(commands, "liquidateDevice", ctx(ops), { deviceId: "d1", proceeds: 99999 }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("acceptPendingInvitation", () => {
  const fakeTx = (invite: unknown) => {
    const calls: string[] = [];
    const tx = {
      invitation: {
        findFirst: vi.fn(async () => invite),
        update: vi.fn(async () => calls.push("invitation.update")),
      },
      profile: {
        update: vi.fn(async (args: unknown) =>
          calls.push(`profile.update ${JSON.stringify(args)}`),
        ),
      },
      activityLog: { create: vi.fn(async () => calls.push("activity")) },
    };
    return { tx: tx as never, calls };
  };
  const now = new Date("2026-11-17T10:00:00Z");

  it("applies the invited role and hub once, with an audit entry", async () => {
    const { tx, calls } = fakeTx({ id: "i1", app_role: "technician", hub_id: "hub_1" });
    expect(
      await acceptPendingInvitation(
        tx,
        { id: "p1", email: "Tech@CertiBuy.test", app_role: "customer" },
        now,
      ),
    ).toBe(true);
    expect(calls[0]).toContain('"app_role":"technician"');
    expect(calls).toContain("invitation.update");
    expect(calls).toContain("activity");
  });

  it("never touches staff accounts or people without an invitation", async () => {
    const staff = fakeTx({ id: "i1", app_role: "ops", hub_id: null });
    expect(
      await acceptPendingInvitation(staff.tx, { id: "p1", email: "a@b.c", app_role: "ops" }, now),
    ).toBe(false);
    expect(staff.calls).toHaveLength(0);
    const none = fakeTx(null);
    expect(
      await acceptPendingInvitation(
        none.tx,
        { id: "p1", email: "a@b.c", app_role: "customer" },
        now,
      ),
    ).toBe(false);
    expect(none.calls).toHaveLength(0);
  });
});

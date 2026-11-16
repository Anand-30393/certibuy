// Role resolution, route guards and the command/view dispatcher (docs/roles.md.txt).
import { EmptyInput } from "@certibuy/contracts";
import { DomainError } from "@certibuy/domain";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AccessDenied, type Actor } from "./actor";
import type { AppContext } from "./context";
import { defineHandler, dispatch } from "./registry";
import { assertHubAccess, assertOwner, canOpenArea, homeFor, mfaSatisfied } from "./policies";

const actor = (over: Partial<Actor> = {}): Actor => ({
  userId: "u1",
  email: "u1@certibuy.test",
  fullName: "User One",
  appRole: "customer",
  activeMode: null,
  hubId: null,
  isPlatformAdmin: false,
  aal: "aal1",
  ...over,
});

describe("homeFor", () => {
  it("routes each role to its landing page", () => {
    expect(homeFor(actor({ appRole: "technician" }))).toBe("/hub");
    expect(homeFor(actor({ appRole: "ops" }))).toBe("/ops");
    expect(homeFor(actor({ activeMode: "seller" }))).toBe("/seller");
    expect(homeFor(actor({ activeMode: "buyer" }))).toBe("/shop");
    expect(homeFor(actor())).toBe("/welcome");
  });
});

describe("canOpenArea", () => {
  const off = { demoMode: false };
  it("lets a customer open both marketplace sides whatever the saved mode", () => {
    const seller = actor({ activeMode: "seller" });
    expect(canOpenArea(seller, "shop", off)).toBe(true);
    expect(canOpenArea(seller, "seller", off)).toBe(true);
    expect(canOpenArea(seller, "hub", off)).toBe(false);
    expect(canOpenArea(seller, "ops", off)).toBe(false);
  });
  it("keeps technicians to the hub and ops to ops + hub", () => {
    expect(canOpenArea(actor({ appRole: "technician" }), "hub", off)).toBe(true);
    expect(canOpenArea(actor({ appRole: "technician" }), "ops", off)).toBe(false);
    expect(canOpenArea(actor({ appRole: "technician" }), "seller", off)).toBe(false);
    expect(canOpenArea(actor({ appRole: "ops" }), "hub", off)).toBe(true);
    expect(canOpenArea(actor({ appRole: "ops" }), "seller", off)).toBe(false);
  });
  it("allows role preview for ops in demo mode and always for platform admins", () => {
    expect(canOpenArea(actor({ appRole: "ops" }), "seller", { demoMode: true })).toBe(true);
    expect(canOpenArea(actor({ isPlatformAdmin: true }), "ops", off)).toBe(true);
  });
});

describe("staff MFA", () => {
  it("requires aal2 for staff only, and only when enforced", () => {
    expect(mfaSatisfied(actor(), true)).toBe(true);
    expect(mfaSatisfied(actor({ appRole: "technician" }), true)).toBe(false);
    expect(mfaSatisfied(actor({ appRole: "technician", aal: "aal2" }), true)).toBe(true);
    expect(mfaSatisfied(actor({ appRole: "ops" }), false)).toBe(true);
  });
});

describe("scoping", () => {
  it("scopes technicians to their own hub", () => {
    const tech = actor({ appRole: "technician", hubId: "hub_a" });
    expect(() => assertHubAccess(tech, "hub_a")).not.toThrow();
    expect(() => assertHubAccess(tech, "hub_b")).toThrow(AccessDenied);
    expect(() => assertHubAccess(actor({ appRole: "ops" }), "hub_b")).not.toThrow();
  });
  it("lets only the owner (or a platform admin) act on a customer record", () => {
    expect(() => assertOwner(actor(), "u1")).not.toThrow();
    expect(() => assertOwner(actor(), "u2")).toThrow(AccessDenied);
  });
});

describe("dispatch", () => {
  const ctx = (a: Actor | null, requireStaffMfa = true): AppContext => ({
    db: {} as AppContext["db"],
    actor: a,
    now: new Date("2026-11-16T10:00:00Z"),
    env: { requireStaffMfa, demoToolsEnabled: false },
  });
  const registry = {
    echo: defineHandler({
      auth: ["customer"],
      input: z.object({ n: z.number().int() }).strict(),
      output: z.object({ n: z.number() }),
      run: async (_c, input) => ({ n: input.n, secret: "never leaves" }),
    }),
    staffOnly: defineHandler({
      auth: ["ops"],
      input: EmptyInput,
      output: z.object({ ok: z.boolean() }),
      run: async () => ({ ok: true }),
    }),
  };

  it("refuses signed-out callers, wrong roles and unknown endpoints", async () => {
    await expect(dispatch(registry, "echo", ctx(null), { n: 1 })).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      dispatch(registry, "echo", ctx(actor({ appRole: "technician" })), { n: 1 }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(dispatch(registry, "nope", ctx(actor()), {})).rejects.toBeInstanceOf(DomainError);
  });

  it("validates input strictly and projects only declared output fields", async () => {
    await expect(dispatch(registry, "echo", ctx(actor()), { n: "x" })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      dispatch(registry, "echo", ctx(actor()), { n: 1, extra: 1 }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await dispatch(registry, "echo", ctx(actor()), { n: 7 })).toEqual({ n: 7 });
  });

  it("requires MFA for staff handlers when enforced", async () => {
    const ops = actor({ appRole: "ops" });
    await expect(dispatch(registry, "staffOnly", ctx(ops), {})).rejects.toMatchObject({
      code: "mfa_required",
    });
    expect(await dispatch(registry, "staffOnly", ctx({ ...ops, aal: "aal2" }), {})).toEqual({
      ok: true,
    });
  });
});

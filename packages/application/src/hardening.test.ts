// Phase 8 regressions: each test pins a money/status bug found in the hardening review.
import { readFileSync } from "node:fs";
import { assertCanRaiseReturn } from "@certibuy/domain";
import { describe, expect, it, vi } from "vitest";
import type { Actor } from "./actor";
import type { AppContext } from "./context";
import { commands } from "./handlers";
import { releaseReservation, reserveListing } from "./listing";
import { runPayoutAttempt } from "./money/payouts";
import { dispatch } from "./registry";

const settings = JSON.parse(
  readFileSync(new URL("../../domain/__fixtures__/settings.default.json", import.meta.url), "utf8"),
).settings;
const settingsRow = { id: 1, settings_version: 1, updated_date: new Date(), ...settings };
const now = new Date("2026-11-17T06:30:00Z"); // 12:00 IST → business date 2026-11-17

function payoutCtx(payout: Record<string, unknown>, claimCount = 1) {
  const transfer = vi.fn(async () => ({ ok: true as const, reference: "SIM-1" }));
  const db = {
    settings: { findUnique: async () => settingsRow },
    payout: {
      findUniqueOrThrow: async () => ({ seller: { payout_account: "upi@x" }, ...payout }),
      updateMany: vi.fn(async () => ({ count: claimCount })),
    },
    $transaction: vi.fn(async () => undefined),
  };
  const ctx = {
    db: db as never,
    payouts: { transfer } as never,
    now,
    actor: null,
    env: { requireStaffMfa: false, demoToolsEnabled: false, appPublicUrl: "http://x" },
  };
  return { ctx, db, transfer };
}

describe("payout attempts move money at most once", () => {
  const base = { id: "p1", amount: 5000, type: "advance", seller_id: "s1", submission_id: null };

  it("refuses a paid payout before calling the rail", async () => {
    const { ctx, transfer } = payoutCtx({ ...base, status: "paid", attempts: 1 });
    await expect(runPayoutAttempt(ctx, "p1")).rejects.toMatchObject({ code: "already_paid" });
    expect(transfer).not.toHaveBeenCalled();
  });

  it("stops when a concurrent run already claimed the attempt", async () => {
    const { ctx, transfer } = payoutCtx({ ...base, status: "pending", attempts: 0 }, 0);
    await expect(runPayoutAttempt(ctx, "p1")).rejects.toMatchObject({
      code: "payout_in_progress",
    });
    expect(transfer).not.toHaveBeenCalled();
  });

  it("claims on the observed attempt count, then pays", async () => {
    const { ctx, db, transfer } = payoutCtx({ ...base, status: "pending", attempts: 0 });
    expect(await runPayoutAttempt(ctx, "p1")).toEqual({ status: "paid", attempts: 1 });
    expect(db.payout.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", attempts: 0, status: "pending" },
      data: { attempts: 1 },
    });
    expect(transfer).toHaveBeenCalledTimes(1);
  });
});

describe("daily job date", () => {
  const ops: Actor = {
    userId: "o1",
    email: "o@x",
    fullName: "Ops",
    appRole: "ops",
    activeMode: null,
    hubId: null,
    isPlatformAdmin: false,
    aal: "aal2",
  };
  it("refuses a future business date (would release escrow inside open return windows)", async () => {
    const ctx = {
      db: { settings: { findUnique: async () => settingsRow } },
      actor: ops,
      now,
      env: { requireStaffMfa: true, demoToolsEnabled: false, appPublicUrl: "http://x" },
    } as unknown as AppContext;
    await expect(
      dispatch(commands, "runDailyJobs", ctx, { businessDate: "2026-12-20" }),
    ).rejects.toMatchObject({ status: 400, code: "future_date" });
  });
});

describe("returns after escrow release", () => {
  it("a settled order can't be returned even if the clock moved back into its window", () => {
    expect(() =>
      assertCanRaiseReturn({
        orderStatus: "settled",
        closesAt: "2026-11-24",
        today: "2026-11-20",
        hasOpenReturn: false,
      }),
    ).toThrow(expect.objectContaining({ code: "window_closed" }));
  });
});

describe("listing reservations", () => {
  it("reserves only at the price that was read, recording the business date", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const tx = { listing: { updateMany } } as never;
    expect(
      await reserveListing(
        tx,
        { id: "l1", current_price: 43710, override_price: null },
        "2026-11-17",
      ),
    ).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "l1", status: "active", current_price: 43710, override_price: null },
      data: { status: "reserved", reserved_since: new Date("2026-11-17T00:00:00Z") },
    });
  });

  it("adds every reservation's days on release (5 held + 3 more = 8)", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      listing: {
        findUnique: async () => ({
          id: "l1",
          status: "reserved",
          reserved_days: 5,
          reserved_since: new Date("2026-11-20T00:00:00Z"),
        }),
        updateMany,
      },
    } as never;
    await releaseReservation(tx, "l1", "2026-11-22");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "l1", status: "reserved" },
      data: { status: "active", reserved_days: 8, reserved_since: null },
    });
  });
});

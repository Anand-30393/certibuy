import { describe, expect, it } from "vitest";
import { isDemoEmail, planDemoReset } from "./demo-reset";

const demo = new Set(["demoSeller", "demoBuyer"]);
const isDemo = (id: string) => demo.has(id);

describe("isDemoEmail", () => {
  it("matches only the reserved demo domain", () => {
    expect(isDemoEmail("demo.customer@certibuy.test")).toBe(true);
    expect(isDemoEmail(" E2E.Invite@CertiBuy.TEST ")).toBe(true);
    expect(isDemoEmail("priya@gmail.com")).toBe(false);
    expect(isDemoEmail("someone@certibuy.test.evil.com")).toBe(false);
    expect(isDemoEmail(null)).toBe(false);
  });
});

describe("planDemoReset", () => {
  it("removes a deal and order that only demo accounts took part in", () => {
    const plan = planDemoReset(
      {
        submissions: [{ id: "s1", sellerId: "demoSeller" }],
        devices: [{ id: "d1", submissionId: "s1" }],
        orders: [{ id: "o1", buyerId: "demoBuyer", deviceId: "d1", replacementDeviceId: null }],
      },
      isDemo,
    );
    expect(plan).toMatchObject({
      submissionIds: ["s1"],
      deviceIds: ["d1"],
      orderIds: ["o1"],
      protectedOrders: 0,
    });
  });

  it("keeps a demo device a real customer bought, with its deal and every order on it", () => {
    const plan = planDemoReset(
      {
        submissions: [{ id: "s1", sellerId: "demoSeller" }],
        devices: [{ id: "d1", submissionId: "s1" }],
        orders: [
          { id: "o-real", buyerId: "realBuyer", deviceId: "d1", replacementDeviceId: null },
          { id: "o-demo", buyerId: "demoBuyer", deviceId: "d1", replacementDeviceId: null },
        ],
      },
      isDemo,
    );
    expect(plan.submissionIds).toEqual([]);
    expect(plan.deviceIds).toEqual([]);
    expect(plan.orderIds).toEqual([]);
    expect(plan.protectedOrders).toBe(2);
  });

  it("keeps a real seller's device even when a demo account bought it", () => {
    const plan = planDemoReset(
      {
        submissions: [{ id: "s-real", sellerId: "realSeller" }],
        devices: [{ id: "d1", submissionId: "s-real" }],
        orders: [{ id: "o1", buyerId: "demoBuyer", deviceId: "d1", replacementDeviceId: null }],
      },
      isDemo,
    );
    expect(plan).toMatchObject({ submissionIds: [], deviceIds: [], orderIds: [] });
  });

  it("spreads protection through a DOA replacement to the other device and its orders", () => {
    const plan = planDemoReset(
      {
        submissions: [
          { id: "s1", sellerId: "demoSeller" },
          { id: "s2", sellerId: "demoSeller" },
          { id: "s3", sellerId: "demoSeller" },
        ],
        devices: [
          { id: "d1", submissionId: "s1" },
          { id: "d2", submissionId: "s2" },
          { id: "d3", submissionId: "s3" },
        ],
        orders: [
          { id: "o-real", buyerId: "realBuyer", deviceId: "d1", replacementDeviceId: "d2" },
          { id: "o-demo", buyerId: "demoBuyer", deviceId: "d2", replacementDeviceId: null },
          { id: "o-free", buyerId: "demoBuyer", deviceId: "d3", replacementDeviceId: null },
        ],
      },
      isDemo,
    );
    expect(plan.deviceIds).toEqual(["d3"]);
    expect(plan.orderIds).toEqual(["o-free"]);
    expect(plan.submissionIds).toEqual(["s3"]);
  });

  it("removes demo deals that never reached a device", () => {
    const plan = planDemoReset(
      {
        submissions: [
          { id: "s1", sellerId: "demoSeller" },
          { id: "s2", sellerId: "realSeller" },
        ],
        devices: [],
        orders: [],
      },
      isDemo,
    );
    expect(plan.submissionIds).toEqual(["s1"]);
    expect(plan.protectedSubmissions).toBe(1);
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Settings } from "@certibuy/domain";
import { describe, expect, it } from "vitest";
import { buildOffer, type OfferInput } from "./offer";

const S: Settings = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../domain/__fixtures__/settings.default.json", import.meta.url)),
    "utf8",
  ),
).settings;

const base: OfferInput = {
  model: { market_price_a: 60000, b2b_floor_price: 30000 },
  estimate: "A",
  band: ["A", "B"],
  confidence: "High",
  score: 72,
  launchWindow: false,
  icPaused: false,
  inventoryTotal: 640000,
  modelExposure: 132000,
};

describe("buildOffer", () => {
  it("prices at the estimate grade (golden PRC-006: ₹60,000 → ₹50,800 / ₹47,800)", () => {
    const o = buildOffer(base, S);
    expect(o).toMatchObject({
      market: 60000,
      guaranteed: 50800,
      instantCash: 47800,
      riskPct: 5,
      riskTier: "low",
      icEligible: true,
      advance: 25400,
      balance: 25400,
    });
  });

  it("shows the guaranteed price at each end of the band as the value range", () => {
    // Grade B market = 60,000 × 0.91 = 54,600 → guaranteed 46,210.
    expect(buildOffer(base, S).valueRange).toEqual({ low: 46210, high: 50800 });
  });

  it("keeps Sell For More but withholds Instant Cash when liquidity is too low", () => {
    const o = buildOffer({ ...base, score: 55 }, S);
    expect(o.icEligible).toBe(false);
    expect(o.icReasonLabel).toBe("low_liquidity");
    expect(o.riskTier).toBe("high");
    expect(o.guaranteed).toBe(50800);
  });

  it("blocks Instant Cash for low confidence and for a paused model", () => {
    expect(buildOffer({ ...base, confidence: "Low" }, S).icReasonLabel).toBe("low_confidence");
    expect(buildOffer({ ...base, icPaused: true }, S).icReasonLabel).toBe("paused");
  });
});

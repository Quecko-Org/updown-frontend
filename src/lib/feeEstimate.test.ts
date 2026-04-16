import { describe, expect, it } from "vitest";
import {
  effectiveFeeBpsAtSharePrice,
  estimateTotalFee,
  probabilityWeightNumerator,
} from "./feeEstimate";

describe("probability-weighted fees", () => {
  it("weight at 50¢ is full scale", () => {
    expect(probabilityWeightNumerator(5000)).toBe(4 * 5000 * 5000);
    expect(probabilityWeightNumerator(5000)).toBe(100_000_000);
  });

  it("effective bps at 50¢ equals total for 150 bps stack", () => {
    expect(effectiveFeeBpsAtSharePrice(150, 5000)).toBe(150);
  });

  it("effective bps at 30¢ for 150 bps stack (integer backend shape)", () => {
    const w = 4 * 3000 * 7000;
    expect(w).toBe(84_000_000);
    expect(effectiveFeeBpsAtSharePrice(150, 3000)).toBe(Math.floor((150 * w) / (10_000 * 10_000)));
    expect(effectiveFeeBpsAtSharePrice(150, 3000)).toBe(126);
  });

  it("estimateTotalFee matches flat model when not probability-weighted", () => {
    const r = estimateTotalFee(100, 150, 3000, "flat");
    expect(r.effectiveFeeBps).toBe(150);
    expect(r.feeUsd).toBe(1.5);
  });

  it("estimateTotalFee uses weight when probability-weighted", () => {
    const r = estimateTotalFee(100, 150, 3000, "probability-weighted");
    expect(r.effectiveFeeBps).toBe(126);
    expect(r.feeUsd).toBeCloseTo(1.26, 5);
    expect(r.effectivePercentOfNotional).toBeCloseTo(1.26, 5);
  });
});

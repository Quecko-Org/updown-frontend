import { describe, it, expect } from "vitest";
import { SLIPPAGE_BPS, computeMarketSlippagePrice } from "./orderConstants";

describe("SLIPPAGE_BPS", () => {
  it("is 500 (= 5%)", () => {
    expect(SLIPPAGE_BPS).toBe(500);
  });
});

describe("computeMarketSlippagePrice", () => {
  // ── BUY side ────────────────────────────────────────────────────────
  it("BUY raises the price by slippage%, rounded UP", () => {
    // 5000 bps + 5% = 5250 bps exact, no rounding needed
    expect(computeMarketSlippagePrice({ orderSide: 0, bestPriceBps: 5000 })).toBe(5250);
  });

  it("BUY rounds non-integer results UP (buyer accepts paying more)", () => {
    // 5233 * 10500 / 10000 = 5494.65 → ceil = 5495
    expect(computeMarketSlippagePrice({ orderSide: 0, bestPriceBps: 5233 })).toBe(5495);
  });

  it("BUY at deep ask still under the 9999 cap", () => {
    // bestAsk = 9500 → 9500 * 1.05 = 9975
    expect(computeMarketSlippagePrice({ orderSide: 0, bestPriceBps: 9500 })).toBe(9975);
  });

  it("BUY at bestAsk whose padded cap overflows saturates to 9999 (QA 2026-07-22)", () => {
    // bestAsk = 9990 → 9990 * 1.05 = 10489.5 → ceil 10490 → saturate to 9999.
    // Returning null here (the pre-fix behavior) made the submit path throw
    // "Insufficient liquidity" against a fully-stocked book.
    expect(computeMarketSlippagePrice({ orderSide: 0, bestPriceBps: 9990 })).toBe(9999);
    // The exact QA repro: 99.0¢ synthetic ask on a near-resolved market.
    expect(computeMarketSlippagePrice({ orderSide: 0, bestPriceBps: 9900 })).toBe(9999);
    // First ask level where the unpadded cap crosses the band edge.
    expect(computeMarketSlippagePrice({ orderSide: 0, bestPriceBps: 9523 })).toBe(9999);
  });

  // ── SELL side ───────────────────────────────────────────────────────
  it("SELL lowers the price by slippage%, rounded DOWN", () => {
    // 5000 * 9500 / 10000 = 4750 exact
    expect(computeMarketSlippagePrice({ orderSide: 1, bestPriceBps: 5000 })).toBe(4750);
  });

  it("SELL rounds non-integer results DOWN (seller accepts receiving less)", () => {
    // 5233 * 9500 / 10000 = 4971.35 → floor = 4971
    expect(computeMarketSlippagePrice({ orderSide: 1, bestPriceBps: 5233 })).toBe(4971);
  });

  it("SELL at low bid that would floor to 0 saturates to 1", () => {
    // bestBid = 10 → 10 * 0.95 = 9.5 → floor 9, still valid
    expect(computeMarketSlippagePrice({ orderSide: 1, bestPriceBps: 10 })).toBe(9);
    // bestBid = 1 → 1 * 0.95 = 0.95 → floor 0 → saturate to the 1 bps minimum
    // (mirror of the BUY overflow: a real bid exists, so the order must sign).
    expect(computeMarketSlippagePrice({ orderSide: 1, bestPriceBps: 1 })).toBe(1);
  });

  // ── Liquidity / out-of-range guards ─────────────────────────────────
  it("returns null when bestPriceBps is missing", () => {
    expect(computeMarketSlippagePrice({ orderSide: 0, bestPriceBps: null })).toBe(null);
    expect(computeMarketSlippagePrice({ orderSide: 0, bestPriceBps: undefined })).toBe(null);
  });

  it("returns null when bestPriceBps is 0", () => {
    // No depth on the relevant side. Caller must reject with "Insufficient liquidity".
    expect(computeMarketSlippagePrice({ orderSide: 0, bestPriceBps: 0 })).toBe(null);
    expect(computeMarketSlippagePrice({ orderSide: 1, bestPriceBps: 0 })).toBe(null);
  });

  it("returns null when bestPriceBps is at the boundary (≥10000)", () => {
    // 10000 means $1.00 — a resolved-side price, not a trading price.
    expect(computeMarketSlippagePrice({ orderSide: 0, bestPriceBps: 10000 })).toBe(null);
    expect(computeMarketSlippagePrice({ orderSide: 1, bestPriceBps: 10001 })).toBe(null);
  });

  it("returns null on NaN / Infinity (defensive)", () => {
    expect(computeMarketSlippagePrice({ orderSide: 0, bestPriceBps: NaN })).toBe(null);
    expect(computeMarketSlippagePrice({ orderSide: 0, bestPriceBps: Infinity })).toBe(null);
  });

  it("honors a caller-supplied slippageBps override (10%)", () => {
    // 5000 + 10% = 5500 exact
    expect(
      computeMarketSlippagePrice({ orderSide: 0, bestPriceBps: 5000, slippageBps: 1000 }),
    ).toBe(5500);
    // 5000 - 10% = 4500 exact
    expect(
      computeMarketSlippagePrice({ orderSide: 1, bestPriceBps: 5000, slippageBps: 1000 }),
    ).toBe(4500);
  });
});

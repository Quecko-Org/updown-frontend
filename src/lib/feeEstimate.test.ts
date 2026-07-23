import { describe, expect, it } from "vitest";
import {
  effectiveFeeBpsAtSharePrice,
  executableAskBpsFromOrderBook,
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

describe("executableAskBpsFromOrderBook", () => {
  // QA 2026-07-23 book: raw UP bid 89.13¢ / raw DOWN bid 8.87¢, no native asks
  // (bids-only DMM — every ask is complementary-synthetic).
  const qaBook = {
    up: { bestBid: { price: 8913 }, bestAsk: null },
    down: { bestBid: { price: 887 }, bestAsk: null },
  };

  it("folds the synthetic ask from the opposite bid (the QA screenshot)", () => {
    // DOWN executable ask = 10000 − 8913 = 10.87¢ (the ↑ row), NOT the 8.87¢ bid
    expect(executableAskBpsFromOrderBook(2, qaBook, true)).toBe(1087);
    // UP executable ask = 10000 − 887 = 91.13¢
    expect(executableAskBpsFromOrderBook(1, qaBook, true)).toBe(9113);
  });

  it("returns null without complementary matching when no native ask exists", () => {
    expect(executableAskBpsFromOrderBook(2, qaBook, false)).toBeNull();
  });

  it("takes the better of native and synthetic ask", () => {
    const book = {
      up: { bestBid: { price: 8913 }, bestAsk: null },
      down: { bestBid: null, bestAsk: { price: 1050 } }, // native 10.5¢ beats synthetic 10.87¢
    };
    expect(executableAskBpsFromOrderBook(2, book, true)).toBe(1050);
    const book2 = {
      up: { bestBid: { price: 8913 }, bestAsk: null },
      down: { bestBid: null, bestAsk: { price: 1200 } }, // synthetic 10.87¢ beats native 12¢
    };
    expect(executableAskBpsFromOrderBook(2, book2, true)).toBe(1087);
  });

  it("returns null on a fully empty book", () => {
    const empty = {
      up: { bestBid: null, bestAsk: null },
      down: { bestBid: null, bestAsk: null },
    };
    expect(executableAskBpsFromOrderBook(1, empty, true)).toBeNull();
    expect(executableAskBpsFromOrderBook(2, empty, true)).toBeNull();
  });
});

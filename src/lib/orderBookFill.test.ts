import { describe, expect, it } from "vitest";
import {
  slippageDecision,
  usdToShares,
  walkBookForAvgFillPrice,
  type BookLevel,
} from "./orderBookFill";

const B = (n: number | string) => BigInt(n);

describe("usdToShares", () => {
  it("$50 at 65¢ floors to 76_923_076 shares (the spec's anchor case)", () => {
    expect(usdToShares(B(50_000_000), B(6500))).toBe(B(76_923_076));
  });

  it("exact at 50¢ — $5 stake = 10 shares", () => {
    expect(usdToShares(B(5_000_000), B(5000))).toBe(B(10_000_000));
  });

  it("zero stake → zero shares", () => {
    expect(usdToShares(B(0), B(5000))).toBe(B(0));
  });

  it("zero price → zero shares (defensive, never throws)", () => {
    expect(usdToShares(B(50_000_000), B(0))).toBe(B(0));
  });

  it("negative price → zero shares (defensive)", () => {
    expect(usdToShares(B(50_000_000), B(-1))).toBe(B(0));
  });

  it("atomic-edge case: 1 atomic stake at 9999 bps = 1 atomic share", () => {
    // (1 × 10000) / 9999 = 1 (floored)
    expect(usdToShares(B(1), B(9999))).toBe(B(1));
  });

  it("rounds DOWN (preserves actualCost ≤ stakeUsd invariant)", () => {
    // (50_000_000 × 10000) / 6500 = 500_000_000_000 / 6500 = 76_923_076.92...
    // → 76_923_076 (floor). Reverse: 76_923_076 × 6500 / 10000 = 49_999_999 atomic.
    // 1 atomic less than stake = the dust that floors to the protocol.
    const shares = usdToShares(B(50_000_000), B(6500));
    const reverseCost = (shares * B(6500)) / B(10_000);
    expect(reverseCost <= B(50_000_000)).toBe(true);
  });
});

describe("walkBookForAvgFillPrice", () => {
  const askLevels: BookLevel[] = [
    { price: 5500, depth: "25000000" }, // $25 at 55¢
    { price: 5800, depth: "50000000" }, // $50 at 58¢
    { price: 6100, depth: "100000000" }, // $100 at 61¢
  ];

  it("empty book → null avg, requiresMoreDepth=true when stake > 0", () => {
    const r = walkBookForAvgFillPrice([], B(10_000_000));
    expect(r.avgPriceBps).toBeNull();
    expect(r.fillableAtomic).toBe(B(0));
    expect(r.requiresMoreDepth).toBe(true);
  });

  it("empty book + zero stake → no fill but no requirement", () => {
    const r = walkBookForAvgFillPrice([], B(0));
    expect(r.avgPriceBps).toBeNull();
    expect(r.fillableAtomic).toBe(B(0));
    expect(r.requiresMoreDepth).toBe(false);
  });

  it("zero stake → no fill", () => {
    const r = walkBookForAvgFillPrice(askLevels, B(0));
    expect(r.avgPriceBps).toBeNull();
    expect(r.fillableAtomic).toBe(B(0));
    expect(r.requiresMoreDepth).toBe(false);
  });

  it("stake within top-of-book depth → top price, full fill", () => {
    const r = walkBookForAvgFillPrice(askLevels, B(10_000_000));
    expect(r.avgPriceBps).toBe(B(5500));
    expect(r.fillableAtomic).toBe(B(10_000_000));
    expect(r.requiresMoreDepth).toBe(false);
  });

  it("stake exactly fills top-of-book → top price, full fill", () => {
    const r = walkBookForAvgFillPrice(askLevels, B(25_000_000));
    expect(r.avgPriceBps).toBe(B(5500));
    expect(r.fillableAtomic).toBe(B(25_000_000));
    expect(r.requiresMoreDepth).toBe(false);
  });

  it("stake walks 2 levels — VWAP correctly weighted", () => {
    // $30 = $25 at 5500 + $5 at 5800
    // weighted = (5500×25M + 5800×5M) / 30M
    // = (137_500_000_000 + 29_000_000_000) / 30_000_000
    // = 166_500_000_000 / 30_000_000 = 5550
    const r = walkBookForAvgFillPrice(askLevels, B(30_000_000));
    expect(r.avgPriceBps).toBe(B(5550));
    expect(r.fillableAtomic).toBe(B(30_000_000));
    expect(r.requiresMoreDepth).toBe(false);
  });

  it("stake walks 3 levels — VWAP across full ladder", () => {
    // $80 = $25 at 5500 + $50 at 5800 + $5 at 6100
    // weighted = (5500×25M + 5800×50M + 6100×5M) / 80M
    // = (137_500_000_000 + 290_000_000_000 + 30_500_000_000) / 80_000_000
    // = 458_000_000_000 / 80_000_000 = 5725
    const r = walkBookForAvgFillPrice(askLevels, B(80_000_000));
    expect(r.avgPriceBps).toBe(B(5725));
    expect(r.fillableAtomic).toBe(B(80_000_000));
    expect(r.requiresMoreDepth).toBe(false);
  });

  it("stake exceeds total depth → partial fill, requiresMoreDepth=true", () => {
    // Total depth = $25 + $50 + $100 = $175. Ask for $200 → fills $175.
    // Weighted over full $175: (5500×25 + 5800×50 + 6100×100)M-bps / 175M
    // = (137.5 + 290 + 610) M-bps / 175M = 1037.5/175 = 5928.5... → floor to 5928
    const r = walkBookForAvgFillPrice(askLevels, B(200_000_000));
    expect(r.avgPriceBps).toBe(B(5928));
    expect(r.fillableAtomic).toBe(B(175_000_000));
    expect(r.requiresMoreDepth).toBe(true);
  });

  it("malformed depth string → skips that level, doesn't throw", () => {
    const messy: BookLevel[] = [
      { price: 5500, depth: "not-a-number" },
      { price: 5600, depth: "25000000" },
    ];
    const r = walkBookForAvgFillPrice(messy, B(10_000_000));
    expect(r.avgPriceBps).toBe(B(5600));
    expect(r.fillableAtomic).toBe(B(10_000_000));
  });

  it("zero-depth level is skipped (defensive)", () => {
    const sparse: BookLevel[] = [
      { price: 5500, depth: "0" },
      { price: 5600, depth: "25000000" },
    ];
    const r = walkBookForAvgFillPrice(sparse, B(10_000_000));
    expect(r.avgPriceBps).toBe(B(5600));
    expect(r.fillableAtomic).toBe(B(10_000_000));
  });
});

describe("slippageDecision (BUY direction: price up = adverse)", () => {
  const THRESHOLD = B(100);

  it("favorable (price down) → silent regardless of magnitude", () => {
    expect(slippageDecision(B(5500), B(5400), 0, THRESHOLD)).toBe("silent");
    expect(slippageDecision(B(5500), B(4000), 0, THRESHOLD)).toBe("silent");
  });

  it("no change → silent", () => {
    expect(slippageDecision(B(5500), B(5500), 0, THRESHOLD)).toBe("silent");
  });

  it("adverse within threshold (≤ 1¢) → silent", () => {
    expect(slippageDecision(B(5500), B(5550), 0, THRESHOLD)).toBe("silent");
    expect(slippageDecision(B(5500), B(5600), 0, THRESHOLD)).toBe("silent"); // exactly at threshold
  });

  it("adverse above threshold (> 1¢) → prompt", () => {
    expect(slippageDecision(B(5500), B(5601), 0, THRESHOLD)).toBe("prompt");
    expect(slippageDecision(B(5500), B(6000), 0, THRESHOLD)).toBe("prompt");
  });
});

describe("slippageDecision (SELL direction: price down = adverse)", () => {
  const THRESHOLD = B(100);

  it("favorable (price up) → silent regardless of magnitude", () => {
    expect(slippageDecision(B(4500), B(4600), 1, THRESHOLD)).toBe("silent");
    expect(slippageDecision(B(4500), B(9000), 1, THRESHOLD)).toBe("silent");
  });

  it("no change → silent", () => {
    expect(slippageDecision(B(4500), B(4500), 1, THRESHOLD)).toBe("silent");
  });

  it("adverse within threshold → silent", () => {
    expect(slippageDecision(B(4500), B(4450), 1, THRESHOLD)).toBe("silent");
    expect(slippageDecision(B(4500), B(4400), 1, THRESHOLD)).toBe("silent"); // exactly at threshold
  });

  it("adverse above threshold → prompt", () => {
    expect(slippageDecision(B(4500), B(4399), 1, THRESHOLD)).toBe("prompt");
    expect(slippageDecision(B(4500), B(3000), 1, THRESHOLD)).toBe("prompt");
  });
});

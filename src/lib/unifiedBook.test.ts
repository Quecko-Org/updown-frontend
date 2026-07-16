import { describe, it, expect } from "vitest";
import { unifyOrderBook } from "./unifiedBook";
import type { OrderBookResponse } from "./api";

const L = (price: number, depth: string, count = 1) => ({ price, depth, count });

function book(partial: {
  upBids?: ReturnType<typeof L>[];
  upAsks?: ReturnType<typeof L>[];
  downBids?: ReturnType<typeof L>[];
  downAsks?: ReturnType<typeof L>[];
}): OrderBookResponse {
  return {
    up: { bids: partial.upBids ?? [], asks: partial.upAsks ?? [] },
    down: { bids: partial.downBids ?? [], asks: partial.downAsks ?? [] },
  };
}

describe("unifyOrderBook", () => {
  it("returns the book unchanged when disabled", () => {
    const b = book({ upBids: [L(6000, "100")], downBids: [L(4000, "50")] });
    expect(unifyOrderBook(b, false)).toBe(b);
  });

  it("folds a DOWN bid into a synthetic UP ask at the complement price (MINT)", () => {
    // DOWN bid @ 4000 → synthetic UP ask @ 10000 - 4000 = 6000.
    const b = book({ downBids: [L(4000, "50", 2)] });
    const u = unifyOrderBook(b, true);
    expect(u.up.asks).toEqual([
      { price: 6000, depth: "50", count: 2, synthetic: true },
    ]);
    // The real DOWN bid is preserved (SELL/cancel path untouched).
    expect(u.down.bids).toEqual([{ price: 4000, depth: "50", count: 2 }]);
  });

  it("folds a DOWN ask into a synthetic UP bid at the complement price (MERGE)", () => {
    // DOWN ask @ 3000 → synthetic UP bid @ 7000.
    const b = book({ downAsks: [L(3000, "40")] });
    const u = unifyOrderBook(b, true);
    expect(u.up.bids).toEqual([{ price: 7000, depth: "40", count: 1, synthetic: true }]);
  });

  it("merges a real UP ask and a synthetic one at the same price, summing depth", () => {
    // Real UP ask @ 6000 (depth 100) + DOWN bid @ 4000 (depth 50) → synthetic UP ask @ 6000.
    const b = book({ upAsks: [L(6000, "100", 1)], downBids: [L(4000, "50", 3)] });
    const u = unifyOrderBook(b, true);
    const at6000 = u.up.asks.find((a) => a.price === 6000)!;
    expect(BigInt(at6000.depth)).toBe(BigInt(150));
    expect(at6000.count).toBe(4);
  });

  it("sorts unified asks ascending and bids descending (best-first for the walk)", () => {
    const b = book({
      upAsks: [L(6500, "10")],
      downBids: [L(4500, "10"), L(3000, "10")], // → UP asks @ 5500 and @ 7000
      upBids: [L(5200, "10")],
      downAsks: [L(2000, "10")], // → UP bid @ 8000
    });
    const u = unifyOrderBook(b, true);
    expect(u.up.asks.map((a) => a.price)).toEqual([5500, 6500, 7000]); // ascending
    expect(u.up.bids.map((a) => a.price)).toEqual([8000, 5200]); // descending
  });

  it("drops degenerate synthetic complements outside the tradeable band", () => {
    // A DOWN bid @ 0 would map to UP ask @ 10000 (>= band) and must be dropped.
    const b = book({ downBids: [L(10000, "10")] }); // complement = 0 → dropped
    const u = unifyOrderBook(b, true);
    expect(u.up.asks).toEqual([]);
  });
});

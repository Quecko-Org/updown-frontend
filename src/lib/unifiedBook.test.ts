import { describe, it, expect } from "vitest";
import { nonCrossingExecutableBps, unifyOrderBook, viewerLevelKeys } from "./unifiedBook";
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

describe("nonCrossingExecutableBps", () => {
  describe("BUY (orderSide 0) vs the synthetic ask", () => {
    it("returns the ask when the limit rests strictly below it (QA round-5 case)", () => {
      // 50¢ BUY below the 50.5¢ synthetic ask → rests, hint shows.
      expect(
        nonCrossingExecutableBps({ orderSide: 0, limitBps: 5000, bestAskBps: 5050, bestBidBps: 4950 }),
      ).toBe(5050);
    });

    it("returns null at exactly the ask (equal price is marketable → no hint)", () => {
      expect(
        nonCrossingExecutableBps({ orderSide: 0, limitBps: 5050, bestAskBps: 5050, bestBidBps: 4950 }),
      ).toBeNull();
    });

    it("returns null when the limit crosses above the ask", () => {
      expect(
        nonCrossingExecutableBps({ orderSide: 0, limitBps: 5100, bestAskBps: 5050, bestBidBps: 4950 }),
      ).toBeNull();
    });

    it("returns null when there is no ask liquidity to compare against", () => {
      expect(
        nonCrossingExecutableBps({ orderSide: 0, limitBps: 5000, bestAskBps: null, bestBidBps: 4950 }),
      ).toBeNull();
      expect(
        nonCrossingExecutableBps({ orderSide: 0, limitBps: 5000, bestAskBps: undefined, bestBidBps: 4950 }),
      ).toBeNull();
    });
  });

  describe("SELL (orderSide 1) vs the best bid", () => {
    it("returns the bid when the limit rests strictly above it", () => {
      expect(
        nonCrossingExecutableBps({ orderSide: 1, limitBps: 5000, bestAskBps: 5050, bestBidBps: 4950 }),
      ).toBe(4950);
    });

    it("returns null at exactly the bid (equal price is marketable → no hint)", () => {
      expect(
        nonCrossingExecutableBps({ orderSide: 1, limitBps: 4950, bestAskBps: 5050, bestBidBps: 4950 }),
      ).toBeNull();
    });

    it("returns null when the limit crosses at or below the bid", () => {
      expect(
        nonCrossingExecutableBps({ orderSide: 1, limitBps: 4900, bestAskBps: 5050, bestBidBps: 4950 }),
      ).toBeNull();
    });

    it("returns null when there is no bid liquidity to compare against", () => {
      expect(
        nonCrossingExecutableBps({ orderSide: 1, limitBps: 5000, bestAskBps: 5050, bestBidBps: null }),
      ).toBeNull();
    });
  });

  it("returns null for a non-positive or non-finite limit price", () => {
    expect(
      nonCrossingExecutableBps({ orderSide: 0, limitBps: 0, bestAskBps: 5050, bestBidBps: 4950 }),
    ).toBeNull();
    expect(
      nonCrossingExecutableBps({ orderSide: 0, limitBps: NaN, bestAskBps: 5050, bestBidBps: 4950 }),
    ).toBeNull();
  });
});

describe("viewerLevelKeys", () => {
  const order = (o: Partial<import("./unifiedBook").ViewerOrderLeg>) => ({
    option: 1,
    side: 0,
    price: 5000,
    status: "OPEN",
    ...o,
  });

  it("returns an empty set for no orders", () => {
    expect(viewerLevelKeys(undefined, true).size).toBe(0);
    expect(viewerLevelKeys([], true).size).toBe(0);
  });

  it("marks a BUY UP as an up bid AND its complementary DOWN-ask mirror (QA round-5)", () => {
    const keys = viewerLevelKeys([order({ option: 1, side: 0, price: 5000 })], true);
    expect(keys.has("up|bid|5000")).toBe(true);
    expect(keys.has("down|ask|5000")).toBe(true);
    expect(keys.size).toBe(2);
  });

  it("marks a BUY DOWN as a down bid with its UP-ask mirror at the complement", () => {
    const keys = viewerLevelKeys([order({ option: 2, side: 0, price: 4850 })], true);
    expect(keys.has("down|bid|4850")).toBe(true);
    expect(keys.has("up|ask|5150")).toBe(true);
  });

  it("marks a SELL UP as an up ask with its DOWN-bid mirror", () => {
    const keys = viewerLevelKeys([order({ option: 1, side: 1, price: 6000 })], true);
    expect(keys.has("up|ask|6000")).toBe(true);
    expect(keys.has("down|bid|4000")).toBe(true);
  });

  it("emits no mirror when complementary matching is off", () => {
    const keys = viewerLevelKeys([order({})], false);
    expect(keys.has("up|bid|5000")).toBe(true);
    expect(keys.size).toBe(1);
  });

  it("includes PARTIALLY_FILLED but ignores FILLED/CANCELLED orders", () => {
    const keys = viewerLevelKeys(
      [
        order({ price: 4000, status: "PARTIALLY_FILLED" }),
        order({ price: 4100, status: "FILLED" }),
        order({ price: 4200, status: "CANCELLED" }),
      ],
      false,
    );
    expect(keys.has("up|bid|4000")).toBe(true);
    expect(keys.size).toBe(1);
  });

  it("ignores malformed rows (bad option, out-of-band or fractional price)", () => {
    const keys = viewerLevelKeys(
      [
        order({ option: 3 }),
        order({ price: 0 }),
        order({ price: 10000 }),
        order({ price: 49.5 }),
      ],
      true,
    );
    expect(keys.size).toBe(0);
  });
});

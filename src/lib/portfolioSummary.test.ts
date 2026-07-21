import { describe, expect, it } from "vitest";
import type { PositionRow } from "./api";
import { computeSummary } from "./portfolioSummary";

// Shares/costBasis are atomic USDT strings (1e6 = $1). A winning share redeems
// 1:1 for face, so a resolved-won row's P&L = shares − cost; a lost row = −cost.
// (BigInt literals `123n` are disallowed by the FE tsconfig target, so the
// expectations use the BigInt() call form the production code uses.)
function pos(over: Partial<PositionRow>): PositionRow {
  return {
    market: "0xmarket1",
    marketStatus: "ACTIVE",
    option: 1,
    optionLabel: "UP",
    shares: "10000000",
    avgPrice: 5000,
    costBasis: "5000000",
    ...over,
  };
}

// winner map keyed by lowercased market address; 1 = UP, 2 = DOWN.
const winners = (m: Record<string, number | null>) =>
  new Map<string, number | null>(Object.entries(m));

describe("computeSummary — realized P&L = settlement term + realized-from-sells", () => {
  it("settlement term alone is unchanged when no realized-from-sells is supplied", () => {
    // Won UP position (+$5 payout − $2 cost = +$3) and a lost UP position (−$4).
    const positions = [
      pos({ market: "0xwon", marketStatus: "RESOLVED", option: 1, shares: "10000000", costBasis: "2000000" }),
      pos({ market: "0xlost", marketStatus: "RESOLVED", option: 1, shares: "10000000", costBasis: "4000000" }),
    ];
    const s = computeSummary(positions, winners({ "0xwon": 1, "0xlost": 2 }));
    // (10M − 2M) + (−4M) = +4M. No scalar passed ⇒ identical to pre-fix.
    expect(s.realizedPnL).toBe(BigInt(4_000_000));
    expect(s.totalResolved).toBe(2);
    expect(s.winRate).toBe(50);
    expect(s.hasRealized).toBe(true);
  });

  it("adds the realized-from-sells scalar to the settlement term", () => {
    const positions = [
      pos({ market: "0xwon", marketStatus: "RESOLVED", option: 1, shares: "10000000", costBasis: "2000000" }),
    ];
    // Settlement +8M, sells +0.5M ⇒ +8.5M combined.
    const s = computeSummary(positions, winners({ "0xwon": 1 }), "500000");
    expect(s.realizedPnL).toBe(BigInt(8_500_000));
    expect(s.hasRealized).toBe(true);
  });

  it("a negative realized-from-sells reduces a positive settlement term", () => {
    const positions = [
      pos({ market: "0xwon", marketStatus: "RESOLVED", option: 1, shares: "10000000", costBasis: "2000000" }),
    ];
    // +8M settlement, −$3M realized loss on sells ⇒ +5M.
    const s = computeSummary(positions, winners({ "0xwon": 1 }), "-3000000");
    expect(s.realizedPnL).toBe(BigInt(5_000_000));
  });

  it("surfaces realized P&L even with NO resolved held positions (sold out before resolution)", () => {
    // The whole point of the fix: a wallet that sold everything before its
    // markets resolved has realized P&L that used to render as "—".
    const positions = [
      pos({ market: "0xactive", marketStatus: "ACTIVE", option: 1, shares: "10000000", costBasis: "5000000" }),
    ];
    const s = computeSummary(positions, winners({}), "700000");
    expect(s.realizedPnL).toBe(BigInt(700_000));
    expect(s.totalResolved).toBe(0); // no held-to-resolution outcomes
    expect(s.winRate).toBeNull(); // win rate is about resolved holds, not sells
    expect(s.hasRealized).toBe(true); // but the realized number IS shown
  });

  it("shows '—' (hasRealized false) only when there is neither a resolution nor a sell", () => {
    const positions = [
      pos({ market: "0xactive", marketStatus: "ACTIVE", option: 1, shares: "10000000", costBasis: "5000000" }),
    ];
    const s = computeSummary(positions, winners({}));
    expect(s.realizedPnL).toBe(BigInt(0));
    expect(s.hasRealized).toBe(false);
    // Active cost still tallies into "invested".
    expect(s.invested).toBe("5000000");
    expect(s.activeCount).toBe(1);
  });

  it("QA wallet 0x996e… combined realized = +1,541,941 atomic (survivors + sells)", () => {
    // Exact backend rows for the two positions still HELD at resolution (the
    // backend fold over the live 14 trades — see positions.test.ts):
    //   -2301: 10,989,010 UP @ cost 4,999,999; DOWN won ⇒ UP lost ⇒ −4,999,999.
    //   -2363: 13,698,630 UP @ cost 5,804,597 (avg-cost after a mid sell); UP
    //          won ⇒ 13,698,630 − 5,804,597 = +7,894,033.
    //   settlement = +2,894,034. The five sold-out markets (dropped from
    //   /positions) net to realizedFromSells = −1,352,093, which the backend now
    //   returns. The page ADDS the two to +1,541,941 — the realized the pre-fix
    //   page could not show (it displayed only the +2,894,034 survivor term).
    const positions = [
      pos({ market: "0xm2301", marketStatus: "RESOLVED", option: 1, optionLabel: "UP", shares: "10989010", costBasis: "4999999" }),
      pos({ market: "0xm2363", marketStatus: "RESOLVED", option: 1, optionLabel: "UP", shares: "13698630", costBasis: "5804597" }),
    ];
    const s = computeSummary(
      positions,
      winners({ "0xm2301": 2, "0xm2363": 1 }),
      "-1352093", // exact on-chain realized-from-sells scalar from the backend
    );
    expect(s.realizedPnL).toBe(BigInt(1_541_941));
    expect(s.hasRealized).toBe(true);
  });
});

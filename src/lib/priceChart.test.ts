import { describe, it, expect } from "vitest";
import {
  chartGridSec,
  resampleUniform,
  settlementHeaderLabel,
  type PricePoint,
} from "./priceChart";
import { formatStrikeUsd } from "./format";

describe("chartGridSec — mirrors the backend chartGridMs", () => {
  it("matches the backend grid for every live timeframe", () => {
    expect(chartGridSec(300)).toBe(1);
    expect(chartGridSec(900)).toBe(1);
    expect(chartGridSec(3600)).toBe(5);
  });

  it("falls back to the coarsest grid for very long windows", () => {
    expect(chartGridSec(24 * 3600)).toBe(60);
  });
});

describe("resampleUniform", () => {
  const T0 = 1_700_000_000;
  const pt = (t: number, p: number): PricePoint => ({ t, p });

  it("is a no-op on a series already on the grid", () => {
    const gridded = [pt(T0, 100), pt(T0 + 5, 101), pt(T0 + 10, 102)];
    expect(resampleUniform(gridded, 5, T0)).toEqual(gridded);
  });

  // The WS price_snapshot handler appends every raw 250ms tick to the same
  // react-query cache the gridded fetch populates. Without this collapse the
  // client rebuilds the exact density cliff the backend grid removed.
  it("collapses appended sub-grid WS ticks back onto the grid, keeping the newest", () => {
    const series = [
      pt(T0, 100),
      pt(T0 + 5, 110),
      // Four raw ticks inside one 5s slot, as the WS handler appends them.
      pt(T0 + 10.0, 120),
      pt(T0 + 10.25, 121),
      pt(T0 + 10.5, 122),
      pt(T0 + 10.75, 123),
    ];
    expect(resampleUniform(series, 5, T0)).toEqual([
      pt(T0, 100),
      pt(T0 + 5, 110),
      // Newest wins — it is the live spot the chart header reads.
      pt(T0 + 10, 123),
    ]);
  });

  it("anchors slots on the market start so no point escapes the window", () => {
    const origin = T0 + 7; // deliberately off any round 5s boundary
    const out = resampleUniform([pt(origin, 100), pt(origin + 4, 104)], 5, origin);
    expect(out).toEqual([pt(origin, 104)]);
    expect(out[0]!.t).toBeGreaterThanOrEqual(origin);
  });

  it("collapses an hour of raw ticks to the 720 points a 5s grid allows", () => {
    const series: PricePoint[] = [];
    for (let i = 0; i < 3600 * 4; i++) series.push(pt(T0 + i * 0.25, 100 + (i % 7)));
    expect(resampleUniform(series, 5, T0)).toHaveLength(720);
  });

  it("passes empty input and a degenerate grid through untouched", () => {
    expect(resampleUniform([], 5, T0)).toEqual([]);
    const one = [pt(T0, 100)];
    expect(resampleUniform(one, 0, T0)).toEqual(one);
  });
});

describe("settlementHeaderLabel", () => {
  // The exact QA 2026-07-16 case: market 588, 18-dec Streams strike, settlement
  // scripted to strike×1.005. The resolved card rendered $65,033.56; the chart
  // header must render the SAME number, not the spot ($64,733.08).
  const RAW_588 = "65033555025000000000000"; // strike 64710.005 × 1.005
  const DEC_588 = 18;

  it("shows the on-chain settlement price for a resolved market", () => {
    expect(settlementHeaderLabel(RAW_588, DEC_588)).toBe("$65,033.56");
  });

  it("is character-identical to the resolved card's formatStrikeUsd (single source of truth)", () => {
    expect(settlementHeaderLabel(RAW_588, DEC_588)).toBe(formatStrikeUsd(RAW_588, DEC_588));
  });

  it("supports legacy 8-decimal markets", () => {
    // 65033.556 at 1e8
    const raw8 = "6503355600000";
    expect(settlementHeaderLabel(raw8, 8)).toBe(formatStrikeUsd(raw8, 8));
    expect(settlementHeaderLabel(raw8, 8)).toBe("$65,033.56");
  });

  it("renders a pending dash — never a spot fallback — while settlement is unsynced", () => {
    // Empty string is the backend default before the on-chain settlement syncs.
    expect(settlementHeaderLabel("", 18)).toBe("—");
    expect(settlementHeaderLabel(undefined, 18)).toBe("—");
    expect(settlementHeaderLabel(null, 18)).toBe("—");
    expect(settlementHeaderLabel("0", 18)).toBe("—");
  });

  it("defaults decimals to the legacy 8-dec scale when omitted", () => {
    const raw8 = "6503355600000";
    expect(settlementHeaderLabel(raw8)).toBe(formatStrikeUsd(raw8));
  });
});

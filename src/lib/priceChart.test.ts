import { describe, it, expect } from "vitest";
import { settlementHeaderLabel } from "./priceChart";
import { formatStrikeUsd } from "./format";

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

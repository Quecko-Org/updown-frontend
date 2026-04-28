import { describe, expect, it } from "vitest";
import { formatUsdCompact } from "./format";

describe("formatUsdCompact", () => {
  it("returns $0 for null/undefined/zero", () => {
    expect(formatUsdCompact(null)).toBe("$0");
    expect(formatUsdCompact(undefined)).toBe("$0");
    expect(formatUsdCompact("0")).toBe("$0");
  });

  it("returns <$1 for sub-dollar volumes", () => {
    expect(formatUsdCompact("500000")).toBe("<$1");
  });

  it("rounds to whole dollars below $1k", () => {
    expect(formatUsdCompact("1000000")).toBe("$1");
    expect(formatUsdCompact("123456000")).toBe("$123");
    expect(formatUsdCompact("999000000")).toBe("$999");
  });

  it("uses one decimal for $1k–$9.9k, no decimal for $10k–$999k", () => {
    expect(formatUsdCompact("1500000000")).toBe("$1.5K");
    expect(formatUsdCompact("12345000000")).toBe("$12K");
    expect(formatUsdCompact("999000000000")).toBe("$999K");
  });

  it("uses one decimal for $1M–$9.9M, no decimal for $10M+", () => {
    expect(formatUsdCompact("1500000000000")).toBe("$1.5M");
    expect(formatUsdCompact("12000000000000")).toBe("$12M");
  });
});

import { describe, expect, it } from "vitest";
import { formatUserFacingError } from "./errors";

describe("formatUserFacingError (hotfix #20 Fix G regex tighten)", () => {
  it('maps "Insufficient balance" to the USDT balance copy (existing behavior)', () => {
    expect(formatUserFacingError(new Error("Insufficient balance"))).toMatch(
      /Insufficient USDT balance/,
    );
  });

  it('maps "insufficient funds for gas" to USDT balance copy', () => {
    expect(
      formatUserFacingError(new Error("insufficient funds for gas * price + value")),
    ).toMatch(/Insufficient USDT balance/);
  });

  it('does NOT match "Insufficient shares to sell" — surfaces verbatim (Shoaib BUG 3)', () => {
    const m = "Insufficient shares to sell. You own $0.00 of UP.";
    const out = formatUserFacingError(new Error(m));
    expect(out).toBe(m);
    expect(out).not.toMatch(/USDT balance/);
  });

  it('does NOT match "Insufficient shares — you don\'t own any UP shares on this market."', () => {
    const m = "Insufficient shares — you don't own any UP shares on this market.";
    expect(formatUserFacingError(new Error(m))).toBe(m);
  });

  it('preserves other known mappings (user rejected, network, 429)', () => {
    expect(formatUserFacingError(new Error("User rejected the request"))).toMatch(
      /Cancelled in wallet/,
    );
    expect(formatUserFacingError(new Error("fetch failed"))).toMatch(/Network error/);
    expect(formatUserFacingError(new Error("429 Too many requests"))).toMatch(/Too many requests/);
  });
});

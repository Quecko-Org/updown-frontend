import { describe, expect, it } from "vitest";
import { formatUserFacingError, isUserRejection } from "./errors";

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
    expect(formatUserFacingError(new Error("429 Too many requests"))).toMatch(/Rate limited/);
  });

  // Bug A from the audit. MetaMask's RPC layer occasionally throws this exact
  // string mid-call; the prior fall-through surfaced it raw as a toast.
  describe("Bug A — JSON-RPC hiccup mapping", () => {
    it('maps "JSON is not a valid request object" to friendly retry copy', () => {
      expect(
        formatUserFacingError(new Error("JSON is not a valid request object")),
      ).toMatch(/Wallet hiccuped/);
    });

    it("maps -32600 (JSON-RPC invalid request code) the same way", () => {
      expect(
        formatUserFacingError(new Error("RPC error: -32600 Invalid request")),
      ).toMatch(/Wallet hiccuped/);
    });

    it('maps "Invalid request" generically', () => {
      expect(formatUserFacingError(new Error("Invalid request"))).toMatch(
        /Wallet hiccuped/,
      );
    });

    it("user rejection still wins over invalid-request match (more specific)", () => {
      // "User rejected the request" contains "request" but should still map to
      // Cancelled-in-wallet because user-rejected matches FIRST.
      expect(
        formatUserFacingError(new Error("User rejected the request")),
      ).toMatch(/Cancelled in wallet/);
    });
  });

  // F2 — order placement on a market that just closed.
  describe("F2 — Market not active mapping", () => {
    it('maps "Market not active" to friendly closed-market copy', () => {
      expect(formatUserFacingError(new Error("Market not active"))).toMatch(
        /This market has ended/,
      );
    });

    it('maps "Invalid signature" to friendly retry copy', () => {
      expect(formatUserFacingError(new Error("Invalid signature"))).toMatch(
        /signature couldn't be verified/,
      );
    });
  });
});

describe("isUserRejection", () => {
  it("returns true for common user-rejection error shapes", () => {
    expect(isUserRejection(new Error("User rejected the request"))).toBe(true);
    expect(isUserRejection(new Error("user denied"))).toBe(true);
    expect(isUserRejection(new Error("Error: 4001 User cancelled"))).toBe(true);
    expect(isUserRejection(new Error("MetaMask Tx Signature: User denied transaction signature."))).toBe(true);
  });

  it("returns false for other errors (so retry-once paths still retry)", () => {
    expect(isUserRejection(new Error("JSON is not a valid request object"))).toBe(false);
    expect(isUserRejection(new Error("network error"))).toBe(false);
    expect(isUserRejection(new Error("Insufficient balance"))).toBe(false);
    expect(isUserRejection(undefined)).toBe(false);
    expect(isUserRejection(null)).toBe(false);
    expect(isUserRejection("string")).toBe(false);
  });
});

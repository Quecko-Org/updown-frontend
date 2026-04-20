import { describe, expect, it } from "vitest";
import {
  buildTerminalOrderToast,
  deriveEffectiveStatus,
  isValidPermissionsContext,
  validateLimitPriceCents,
} from "./derivations";

describe("deriveEffectiveStatus (Fix 1a countdown flip)", () => {
  it("flips ACTIVE to TRADING_ENDED at 0:00", () => {
    expect(deriveEffectiveStatus("ACTIVE", "0:00")).toBe("TRADING_ENDED");
  });

  it("leaves ACTIVE alone while countdown > 0", () => {
    expect(deriveEffectiveStatus("ACTIVE", "4:59")).toBe("ACTIVE");
    expect(deriveEffectiveStatus("ACTIVE", "0:01")).toBe("ACTIVE");
  });

  it("does not touch already-resolved statuses at 0:00", () => {
    expect(deriveEffectiveStatus("RESOLVED", "0:00")).toBe("RESOLVED");
    expect(deriveEffectiveStatus("CLAIMED", "0:00")).toBe("CLAIMED");
    expect(deriveEffectiveStatus("TRADING_ENDED", "0:00")).toBe("TRADING_ENDED");
  });

  it("does not touch already-resolved statuses while counting down", () => {
    expect(deriveEffectiveStatus("RESOLVED", "1:23")).toBe("RESOLVED");
  });
});

describe("isValidPermissionsContext (Fix 3b)", () => {
  it("accepts 0x-prefixed hex", () => {
    expect(isValidPermissionsContext("0xdeadbeef")).toBe(true);
  });

  it("rejects empty and missing values", () => {
    expect(isValidPermissionsContext("")).toBe(false);
    expect(isValidPermissionsContext(null)).toBe(false);
    expect(isValidPermissionsContext(undefined)).toBe(false);
  });

  it("rejects non-hex strings (old silent-JSON.stringify fallback)", () => {
    expect(isValidPermissionsContext('{"permissions":[]}')).toBe(false);
    expect(isValidPermissionsContext("plainstring")).toBe(false);
    expect(isValidPermissionsContext("0x")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidPermissionsContext(42)).toBe(false);
    expect(isValidPermissionsContext({ context: "0x1" })).toBe(false);
  });
});

describe("buildTerminalOrderToast (Fix 2c + P1 hotfix relaxed maker guard)", () => {
  const wallet = "0xd2a370fdf17dd05f6d96b722b2178340e0ec1a9c";

  it("returns null when no wallet is connected", () => {
    const t = buildTerminalOrderToast(
      { id: "a", maker: wallet, status: "CANCELLED", amount: "5000000", filledAmount: "0" },
      null,
    );
    expect(t).toBeNull();
  });

  it("emits info toast for no-liquidity CANCELLED (Shoaib Test 2 repro — maker present)", () => {
    const t = buildTerminalOrderToast(
      { id: "cee0cf14", maker: wallet, status: "CANCELLED", amount: "5000000", filledAmount: "0" },
      wallet,
    );
    expect(t?.kind).toBe("info");
    expect(t?.message).toMatch(/No liquidity matched/);
    expect(t?.id).toBe("cee0cf14-terminal");
  });

  // The P1 hotfix relaxes the maker guard: the WS channel subscription
  // (`orders:${wallet}`) already ensures frames only reach our wallet. Under
  // pre-hotfix backend builds, `data.maker` could be undefined — requiring
  // it made the toast never fire. Post-hotfix backend SENDS `maker`, but the
  // frontend stays forgiving so rollback doesn't silently break UX.
  it("still emits toast when server omits maker (legacy payload)", () => {
    const t = buildTerminalOrderToast(
      { id: "x", status: "CANCELLED", amount: "5000000", filledAmount: "0" },
      wallet,
    );
    expect(t?.kind).toBe("info");
  });

  it("still drops frames whose maker does not match (belt-and-suspenders)", () => {
    const t = buildTerminalOrderToast(
      { id: "a", maker: "0x1111111111111111111111111111111111111111", status: "CANCELLED", amount: "5000000", filledAmount: "0" },
      wallet,
    );
    expect(t).toBeNull();
  });

  it("emits info toast with fmtUsd values for partial-fill cancellation", () => {
    const t = buildTerminalOrderToast(
      { id: "x", maker: wallet, status: "CANCELLED", amount: "10000000", filledAmount: "3000000" },
      wallet,
    );
    expect(t?.kind).toBe("info");
    expect(t?.message).toContain("$3.00");
    expect(t?.message).toContain("$10.00");
    expect(t?.message).toMatch(/remainder cancelled/);
  });

  it("emits success toast on FILLED", () => {
    const t = buildTerminalOrderToast(
      { id: "x", maker: wallet, status: "FILLED", amount: "25000000", filledAmount: "25000000" },
      wallet,
    );
    expect(t?.kind).toBe("success");
    expect(t?.message).toContain("$25.00");
  });

  it("stays quiet on non-terminal PARTIALLY_FILLED (more fills may arrive)", () => {
    const t = buildTerminalOrderToast(
      { id: "x", maker: wallet, status: "PARTIALLY_FILLED", amount: "10000000", filledAmount: "3000000" },
      wallet,
    );
    expect(t).toBeNull();
  });

  it("is case-insensitive on wallet comparison (when maker present)", () => {
    const t = buildTerminalOrderToast(
      { id: "x", maker: wallet.toUpperCase(), status: "FILLED", amount: "5000000", filledAmount: "5000000" },
      wallet.toLowerCase(),
    );
    expect(t?.kind).toBe("success");
  });

  // Hotfix #20 Fix G: reason-aware copy. Tests pin exact strings so they match
  // the user-visible toast assertions in QA.
  describe("reason-aware copy (hotfix #20 Fix G)", () => {
    const base = { id: "x", maker: wallet, amount: "5000000", filledAmount: "0" };

    it("MARKET_ENDED → distinct copy (Shoaib BUG 3 exact fix)", () => {
      const t = buildTerminalOrderToast(
        { ...base, status: "CANCELLED", reason: "MARKET_ENDED" },
        wallet,
      );
      expect(t?.message).toBe("Market ended — your order was cancelled, balance returned.");
    });

    it("EXPIRED → expired copy", () => {
      const t = buildTerminalOrderToast(
        { ...base, status: "CANCELLED", reason: "EXPIRED" },
        wallet,
      );
      expect(t?.message).toMatch(/expired/i);
    });

    it("USER_CANCEL → user-initiated copy", () => {
      const t = buildTerminalOrderToast(
        { ...base, status: "CANCELLED", reason: "USER_CANCEL" },
        wallet,
      );
      expect(t?.message).toBe("Order cancelled — balance returned.");
    });

    it("KILL_SWITCH → bulk-cancel copy", () => {
      const t = buildTerminalOrderToast(
        { ...base, status: "CANCELLED", reason: "KILL_SWITCH" },
        wallet,
      );
      expect(t?.message).toMatch(/All your orders on this market/);
    });

    it("SESSION_EXPIRED → session copy", () => {
      const t = buildTerminalOrderToast(
        { ...base, status: "CANCELLED", reason: "SESSION_EXPIRED" },
        wallet,
      );
      expect(t?.message).toMatch(/Session expired/i);
    });

    it("NO_LIQUIDITY falls through to prior default copy", () => {
      const t = buildTerminalOrderToast(
        { ...base, status: "CANCELLED", reason: "NO_LIQUIDITY" },
        wallet,
      );
      expect(t?.message).toBe("No liquidity matched — order cancelled, balance returned.");
    });

    it("missing reason still renders (backend rollback compat)", () => {
      const t = buildTerminalOrderToast(
        { ...base, status: "CANCELLED" },
        wallet,
      );
      expect(t?.message).toBe("No liquidity matched — order cancelled, balance returned.");
    });
  });
});

describe("validateLimitPriceCents (Fix A price input)", () => {
  it("accepts integer cents in [1, 99]", () => {
    expect(validateLimitPriceCents("1")).toEqual({ value: 1, error: null });
    expect(validateLimitPriceCents("50")).toEqual({ value: 50, error: null });
    expect(validateLimitPriceCents("99")).toEqual({ value: 99, error: null });
  });

  it("rejects 0, 100, 150 (outside probability range)", () => {
    expect(validateLimitPriceCents("0").value).toBeNull();
    expect(validateLimitPriceCents("0").error).toMatch(/at least 1/);
    expect(validateLimitPriceCents("100").value).toBeNull();
    expect(validateLimitPriceCents("100").error).toMatch(/at most 99/);
    expect(validateLimitPriceCents("150").value).toBeNull();
  });

  it("rejects non-integers and garbage", () => {
    expect(validateLimitPriceCents("50.5").value).toBeNull();
    expect(validateLimitPriceCents("50.5").error).toMatch(/whole cents/i);
    expect(validateLimitPriceCents("abc").value).toBeNull();
    expect(validateLimitPriceCents("").error).toMatch(/enter a price/i);
    expect(validateLimitPriceCents("-5").value).toBeNull();
  });

  it("accepts whitespace-padded input", () => {
    expect(validateLimitPriceCents("  50  ")).toEqual({ value: 50, error: null });
  });

  it("accepts number type (not just string)", () => {
    expect(validateLimitPriceCents(42)).toEqual({ value: 42, error: null });
  });
});

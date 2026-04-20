import { describe, expect, it } from "vitest";
import {
  buildTerminalOrderToast,
  deriveEffectiveStatus,
  isValidPermissionsContext,
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

describe("buildTerminalOrderToast (Fix 2c)", () => {
  const wallet = "0xd2a370fdf17dd05f6d96b722b2178340e0ec1a9c";

  it("returns null for orders of other wallets", () => {
    const t = buildTerminalOrderToast(
      { id: "a", maker: "0x1111111111111111111111111111111111111111", status: "CANCELLED", amount: "5000000", filledAmount: "0" },
      wallet,
    );
    expect(t).toBeNull();
  });

  it("returns null when no wallet is connected", () => {
    const t = buildTerminalOrderToast(
      { id: "a", maker: wallet, status: "CANCELLED", amount: "5000000", filledAmount: "0" },
      null,
    );
    expect(t).toBeNull();
  });

  it("emits info toast for no-liquidity CANCELLED (the Shoaib MARKET-order case)", () => {
    const t = buildTerminalOrderToast(
      { id: "cee0cf14", maker: wallet, status: "CANCELLED", amount: "5000000", filledAmount: "0" },
      wallet,
    );
    expect(t?.kind).toBe("info");
    expect(t?.message).toMatch(/No liquidity matched/);
    expect(t?.id).toBe("cee0cf14-terminal");
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

  it("is case-insensitive on wallet comparison", () => {
    const t = buildTerminalOrderToast(
      { id: "x", maker: wallet.toUpperCase(), status: "FILLED", amount: "5000000", filledAmount: "5000000" },
      wallet.toLowerCase(),
    );
    expect(t?.kind).toBe("success");
  });
});

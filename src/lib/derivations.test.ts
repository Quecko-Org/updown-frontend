import { describe, expect, it } from "vitest";
import {
  applyOrderUpdateToList,
  buildTerminalOrderToast,
  deriveEffectiveStatus,
  formatResolutionOutcome,
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

describe("applyOrderUpdateToList (Fix 1b event-based order cache merge)", () => {
  const baseRow = (over: Record<string, unknown> = {}) => ({
    orderId: "abc",
    maker: "0xabc",
    market: "0xmkt",
    option: 1,
    side: 0,
    type: 0,
    price: 5500,
    amount: "25000000",
    filledAmount: "0",
    status: "OPEN",
    createdAt: "2026-04-20T00:00:00Z",
    updatedAt: "2026-04-20T00:00:00Z",
    ...over,
  });

  it("updates status + filledAmount on the matching row", () => {
    const list = { orders: [baseRow(), baseRow({ orderId: "xyz" })], total: 2, limit: 50, offset: 0 };
    const next = applyOrderUpdateToList(list, { id: "abc", status: "FILLED", filledAmount: "25000000" });
    expect(next).not.toBe(list);
    expect(next!.orders[0].status).toBe("FILLED");
    expect(next!.orders[0].filledAmount).toBe("25000000");
    expect(next!.orders[1]).toBe(list.orders[1]); // untouched row reference preserved
  });

  it("returns the same list reference when no order matches (React Query no-op)", () => {
    const list = { orders: [baseRow()], total: 1, limit: 50, offset: 0 };
    const next = applyOrderUpdateToList(list, { id: "no-such-id", status: "FILLED" });
    expect(next).toBe(list);
  });

  it("carries reason through on CANCELLED transitions", () => {
    const list = { orders: [baseRow()], total: 1, limit: 50, offset: 0 };
    const next = applyOrderUpdateToList(list, { id: "abc", status: "CANCELLED", reason: "USER_CANCEL" });
    expect(next!.orders[0].status).toBe("CANCELLED");
    expect(next!.orders[0].reason).toBe("USER_CANCEL");
  });

  it("only updates fields present in the payload (partial merges)", () => {
    const list = { orders: [baseRow({ status: "PARTIALLY_FILLED", filledAmount: "5000000" })], total: 1, limit: 50, offset: 0 };
    const next = applyOrderUpdateToList(list, { id: "abc", filledAmount: "15000000" });
    expect(next!.orders[0].status).toBe("PARTIALLY_FILLED"); // unchanged
    expect(next!.orders[0].filledAmount).toBe("15000000");
  });

  it("returns input unchanged when list is undefined (WS arrived before hydrate)", () => {
    const next = applyOrderUpdateToList(undefined, { id: "abc", status: "FILLED" });
    expect(next).toBeUndefined();
  });

  it("returns input unchanged when update has no id", () => {
    const list = { orders: [baseRow()], total: 1, limit: 50, offset: 0 };
    const next = applyOrderUpdateToList(list, { status: "FILLED" });
    expect(next).toBe(list);
  });

  // Bug B (placement-emit): backend now emits order_update on initial LIMIT
  // rest. The frontend cache may not yet contain the order id (the GET /orders
  // refetch hasn't landed). Without prepend support, the order would stay
  // invisible until the next 20s poll.
  describe("Bug B — placement-emit prepend", () => {
    const placementUpdate = {
      id: "new-order-id",
      maker: "0xalice",
      market: "0xmkt-9",
      option: 1,
      side: 0,
      orderType: 0,
      price: 4500,
      amount: "25000000",
      filledAmount: "0",
      status: "OPEN",
      createdAt: 1730000000000,
    };

    it("prepends a synthesized row when id is unknown and payload is complete", () => {
      const list = { orders: [baseRow({ orderId: "existing" })], total: 1, limit: 50, offset: 0 };
      const next = applyOrderUpdateToList(list, placementUpdate);
      expect(next).not.toBe(list);
      expect(next!.orders.length).toBe(2);
      expect(next!.orders[0].orderId).toBe("new-order-id");
      expect(next!.orders[0].status).toBe("OPEN");
      expect(next!.orders[0].price).toBe(4500);
      expect(next!.orders[0].type).toBe(0);
      expect(next!.orders[1].orderId).toBe("existing");
    });

    it("does NOT prepend when payload is missing required fields (legacy backend)", () => {
      const list = { orders: [baseRow()], total: 1, limit: 50, offset: 0 };
      const legacyUpdate = { id: "new-id", status: "OPEN", filledAmount: "0" };
      const next = applyOrderUpdateToList(list, legacyUpdate);
      expect(next).toBe(list);
    });

    it("patches in place (does NOT also prepend) when id matches existing row", () => {
      const list = {
        orders: [baseRow({ orderId: "new-order-id", status: "OPEN", filledAmount: "0" })],
        total: 1,
        limit: 50,
        offset: 0,
      };
      const next = applyOrderUpdateToList(list, { ...placementUpdate, status: "FILLED", filledAmount: "25000000" });
      expect(next!.orders.length).toBe(1);
      expect(next!.orders[0].status).toBe("FILLED");
      expect(next!.orders[0].filledAmount).toBe("25000000");
    });
  });
});

describe("deriveEffectiveStatus edge cases", () => {
  it("treats an empty backend status as the passthrough — don't flip anything", () => {
    expect(deriveEffectiveStatus("", "0:00")).toBe("");
  });

  it("only flips the exact 0:00 string; any non-zero countdown keeps ACTIVE", () => {
    expect(deriveEffectiveStatus("ACTIVE", "0:00")).toBe("TRADING_ENDED");
    expect(deriveEffectiveStatus("ACTIVE", "0:01")).toBe("ACTIVE");
  });
});

describe("formatResolutionOutcome (Bug C + Display-1)", () => {
  const base = (over: Record<string, unknown> = {}) => ({
    status: "RESOLVED",
    winner: 1 as number | null,
    strikePrice: "5000000000000",
    settlementPrice: "5050000000000",
    ...over,
  });

  it("returns UP-won label and winnerSide=1 for resolved UP markets", () => {
    const r = formatResolutionOutcome(base({ winner: 1 }));
    expect(r.label).toBe("UP won");
    expect(r.winnerSide).toBe(1);
  });

  it("returns DOWN-won label and winnerSide=2 for resolved DOWN markets", () => {
    const r = formatResolutionOutcome(base({ winner: 2 }));
    expect(r.label).toBe("DOWN won");
    expect(r.winnerSide).toBe(2);
  });

  it("returns null label for unresolved (ACTIVE) markets even with non-null winner", () => {
    const r = formatResolutionOutcome(base({ status: "ACTIVE", winner: 1 }));
    expect(r.label).toBeNull();
    expect(r.winnerSide).toBeNull();
  });

  it("returns null label for status=CLAIMED + winner=0 (resolved-tie sentinel)", () => {
    const r = formatResolutionOutcome(base({ status: "CLAIMED", winner: 0 }));
    expect(r.label).toBeNull();
    expect(r.winnerSide).toBeNull();
  });

  it("treats CLAIMED the same as RESOLVED for the winner badge", () => {
    const r = formatResolutionOutcome(base({ status: "CLAIMED", winner: 2 }));
    expect(r.label).toBe("DOWN won");
    expect(r.winnerSide).toBe(2);
  });

  it("renders signed delta percent at 2dp for typical magnitudes", () => {
    const r = formatResolutionOutcome(
      base({ winner: 1, strikePrice: "100", settlementPrice: "105" }),
    );
    expect(r.deltaPctStr).toBe("+5.00%");
    expect(r.deltaUsedFinePrecision).toBe(false);
  });

  it("renders negative delta with the unicode minus", () => {
    const r = formatResolutionOutcome(
      base({ winner: 2, strikePrice: "100", settlementPrice: "95" }),
    );
    expect(r.deltaPctStr).toBe("−5.00%");
  });

  // Display-1: when |delta| would round to 0.00% but is non-zero, switch to
  // 4dp so the user can tell why DOWN won when strike and settled appear equal.
  it("Display-1 — sub-cent delta switches to 4dp precision (DOWN-won case)", () => {
    // strike=$77,816.84, settled=$77,816.83 → ~ −0.00128%, would round to 0.00%
    const r = formatResolutionOutcome(
      base({ winner: 2, strikePrice: "7781684", settlementPrice: "7781683" }),
    );
    expect(r.deltaUsedFinePrecision).toBe(true);
    expect(r.deltaPctStr).toMatch(/^−0\.\d{4}%$/);
  });

  it("Display-1 — exact tie (settled == strike) returns 0.00 (no fine precision)", () => {
    const r = formatResolutionOutcome(
      base({ winner: 2, strikePrice: "100", settlementPrice: "100" }),
    );
    expect(r.deltaPctStr).toBe("+0.00%");
    expect(r.deltaUsedFinePrecision).toBe(false);
  });

  it("returns null deltaPctStr when settlementPrice is missing", () => {
    const r = formatResolutionOutcome(
      base({ winner: 1, settlementPrice: undefined }),
    );
    expect(r.deltaPctStr).toBeNull();
  });

  it("returns null deltaPctStr when strikePrice is zero (avoid division-by-zero)", () => {
    const r = formatResolutionOutcome(
      base({ winner: 1, strikePrice: "0", settlementPrice: "100" }),
    );
    expect(r.deltaPctStr).toBeNull();
  });
});

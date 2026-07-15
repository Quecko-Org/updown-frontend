import { describe, expect, it } from "vitest";

import { EXPIRY_MODES, expiryForMode, type ExpiryMode } from "./TradeForm";

/**
 * F-17703 — the expiry the trade form signs must always be in the FUTURE.
 *
 * UpDownSettlement reverts `OrderExpired` on `block.timestamp > order.expiry`,
 * so `expiry = 0` is not a "never expires" sentinel: it is an order that
 * matches off-chain, mints a Trade row, and then reverts at settlement forever.
 * The form used to ship a "Never" radio that minted exactly that. The expiry is
 * inside the EIP-712 digest, so the FE has to sign the real value it intends —
 * the backend cannot substitute one for it.
 */
describe("TradeForm expiry", () => {
  const NOW_MS = 1_800_000_000_000; // fixed clock; nowSec = 1_800_000_000
  const NOW_SEC = Math.floor(NOW_MS / 1000);
  const END_TIME = NOW_SEC + 900; // an ACTIVE market closing in 15 min

  it("offers no mode that mints a non-settleable expiry", () => {
    for (const mode of EXPIRY_MODES) {
      expect(expiryForMode(mode.id, END_TIME, NOW_MS)).toBeGreaterThan(NOW_SEC);
    }
    // The "Never" radio is what minted expiry=0; it must not be selectable.
    expect(EXPIRY_MODES.map((m) => m.id)).not.toContain("never");
  });

  it('"close" bounds the order by the market it trades', () => {
    expect(expiryForMode("close", END_TIME, NOW_MS)).toBe(END_TIME);
  });

  it('"1h" signs one hour out', () => {
    expect(expiryForMode("1h", END_TIME, NOW_MS)).toBe(NOW_SEC + 3600);
  });

  it("never returns 0 for any mode the union permits", () => {
    const modes: ExpiryMode[] = ["1h", "close"];
    for (const mode of modes) {
      expect(expiryForMode(mode, END_TIME, NOW_MS)).not.toBe(0);
    }
  });
});

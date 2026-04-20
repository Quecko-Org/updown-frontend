/**
 * Small pure helpers extracted from React components so they can be unit-tested
 * without a DOM / React test harness. Keep everything here synchronous and
 * side-effect-free.
 */

import { fmtUsd } from "./format";

/**
 * Countdown-driven state flip: if a market's backend status still says ACTIVE but
 * the local countdown has hit 0:00, render as if it were TRADING_ENDED. Keeps the
 * card honest during backend sync lag (up to a few minutes) without lying about
 * already-resolved markets.
 */
export function deriveEffectiveStatus(status: string, countdown: string): string {
  if (countdown === "0:00" && status === "ACTIVE") return "TRADING_ENDED";
  return status;
}

/** Validates that a `permissionsContext` string from Alchemy is a usable hex blob. */
export function isValidPermissionsContext(value: unknown): value is `0x${string}` {
  return typeof value === "string" && value.length > 2 && value.startsWith("0x");
}

export type OrderUpdateLike = {
  id?: string;
  maker?: string;
  amount?: string;
  filledAmount?: string;
  status?: string;
};

export type TerminalToast =
  | { kind: "info"; message: string; id: string }
  | { kind: "success"; message: string; id: string }
  | null;

/**
 * Return the toast (or null) that should fire when an `order_update` WS message
 * arrives. We only toast for the connected wallet AND only on terminal transitions
 * (CANCELLED with / without fills, FILLED). PARTIALLY_FILLED stays quiet while the
 * order may still receive more fills.
 */
export function buildTerminalOrderToast(
  data: OrderUpdateLike,
  connectedWallet: string | null | undefined,
): TerminalToast {
  if (!data || !data.status) return null;
  if (!connectedWallet || !data.maker) return null;
  if (data.maker.toLowerCase() !== connectedWallet.toLowerCase()) return null;

  const id = `${data.id ?? "order"}-terminal`;
  const filled = data.filledAmount ?? "0";
  const amount = data.amount ?? "0";

  if (data.status === "CANCELLED") {
    if (!filled || filled === "0") {
      return { kind: "info", message: "No liquidity matched — order cancelled, balance returned.", id };
    }
    return {
      kind: "info",
      message: `Order partially filled (${fmtUsd(filled)} of ${fmtUsd(amount)}) — remainder cancelled.`,
      id,
    };
  }
  if (data.status === "FILLED") {
    return { kind: "success", message: `Order filled: ${fmtUsd(amount)}.`, id };
  }
  return null;
}

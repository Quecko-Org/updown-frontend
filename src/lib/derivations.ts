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
 * arrives. Terminal transitions only — CANCELLED (with / without fills) or FILLED.
 * PARTIALLY_FILLED stays quiet while the order may still receive more fills.
 *
 * Wallet-scoped filtering happens at the WebSocket channel subscription layer
 * (`orders:${maker}`), so we DO NOT re-check maker here. Requiring `data.maker`
 * to match broke the toast path when the backend omitted `maker` from the
 * broadcast payload — see sibling backend fix. Keeping this guard optional means
 * older server builds missing the field still surface toasts correctly.
 */
export function buildTerminalOrderToast(
  data: OrderUpdateLike,
  connectedWallet: string | null | undefined,
): TerminalToast {
  if (!data || !data.status) return null;
  if (!connectedWallet) return null;
  // Defensive belt-and-suspenders: if the server DID send `maker`, still require
  // it to match. Drops cross-wallet frames in the (vanishingly rare) case the
  // hub ever fan-outs a wrong channel to us.
  if (data.maker && data.maker.toLowerCase() !== connectedWallet.toLowerCase()) return null;

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

/**
 * Validate a cents-denominated LIMIT price input (1-99¢). Input comes from a
 * text field so we tolerate whitespace + trailing decimals; output is an integer
 * in the [1, 99] range plus an optional error string.
 */
export function validateLimitPriceCents(raw: string | number): {
  value: number | null;
  error: string | null;
} {
  const trimmed = typeof raw === "string" ? raw.trim() : String(raw).trim();
  if (trimmed === "") return { value: null, error: "Enter a price (1-99¢)" };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { value: null, error: "Not a number" };
  if (!Number.isInteger(n)) return { value: null, error: "Whole cents only (1-99)" };
  if (n < 1) return { value: null, error: "Price must be at least 1¢" };
  if (n > 99) return { value: null, error: "Price must be at most 99¢" };
  return { value: n, error: null };
}

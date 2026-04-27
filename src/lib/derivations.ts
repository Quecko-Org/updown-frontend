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

/**
 * Single source of truth for resolved-market outcome rendering. Pre-extraction
 * the home card (MarketCard), the market detail page (MarketPageClient), and
 * the History trade rows each had their own derivation — the detail page was
 * showing live spot direction labelled "Currently" even AFTER resolution,
 * which contradicted the home card's "DOWN won" badge whenever the spot had
 * recovered above strike post-resolve. Bug C in the audit.
 *
 * Display-1: when the rounded delta would render as "+0.00%" (sub-cent gap),
 * fall back to 4-decimal precision instead so the user can see why DOWN won
 * an apparent tie. The settlement rule on-chain is `settled > strike => UP,
 * settled <= strike => DOWN`, so a tie always favors DOWN.
 */
export type ResolutionOutcome = {
  /** "UP won" / "DOWN won" — null if market hasn't resolved (winner === 0 or null). */
  label: string | null;
  /** 1 = UP, 2 = DOWN, null if not yet resolved. */
  winnerSide: 1 | 2 | null;
  /** Pretty-formatted delta percent (signed), null when no settlement price. */
  deltaPctStr: string | null;
  /** True when the rendered delta required extra precision (Display-1 path). */
  deltaUsedFinePrecision: boolean;
};

export function formatResolutionOutcome(market: {
  status: string;
  winner: number | null;
  strikePrice?: string;
  settlementPrice?: string;
}): ResolutionOutcome {
  const isResolved = market.status === "RESOLVED" || market.status === "CLAIMED";
  const winnerSide: 1 | 2 | null =
    isResolved && market.winner === 1 ? 1 : isResolved && market.winner === 2 ? 2 : null;

  const label = winnerSide === 1 ? "UP won" : winnerSide === 2 ? "DOWN won" : null;

  let deltaPctStr: string | null = null;
  let deltaUsedFinePrecision = false;
  const strike = market.strikePrice ? Number(market.strikePrice) : NaN;
  const settled = market.settlementPrice ? Number(market.settlementPrice) : NaN;
  if (Number.isFinite(strike) && Number.isFinite(settled) && strike !== 0) {
    const pct = ((settled - strike) / strike) * 100;
    const sign = pct >= 0 ? "+" : "−";
    const abs = Math.abs(pct);
    // Display-1: a sub-cent gap rounds to "0.00%" but the winner is determined
    // by the exact comparison. Show extra precision when the 2dp render would
    // collapse to "0.00%", so the user sees a non-zero delta that justifies
    // the resolution rather than appearing to contradict it.
    if (abs > 0 && abs < 0.005) {
      deltaPctStr = `${sign}${abs.toFixed(4)}%`;
      deltaUsedFinePrecision = true;
    } else {
      deltaPctStr = `${sign}${abs.toFixed(2)}%`;
    }
  }

  return { label, winnerSide, deltaPctStr, deltaUsedFinePrecision };
}

/**
 * Mirrors the backend `CancelReason` enum attached to `order_update` frames on
 * CANCELLED transitions. Frontend routes toast copy on this value instead of
 * collapsing every cancel into "no liquidity matched".
 */
export type CancelReason =
  | "NO_LIQUIDITY"
  | "MARKET_ENDED"
  | "EXPIRED"
  | "USER_CANCEL"
  | "KILL_SWITCH"
  | "SESSION_EXPIRED";

export type OrderUpdateLike = {
  id?: string;
  maker?: string;
  market?: string;
  option?: number;
  side?: number;
  /** Backend renames `type` -> `orderType` on the wire to dodge the reserved
   *  `type: 'order_update'` field at the message envelope level. */
  orderType?: number;
  price?: number;
  amount?: string;
  filledAmount?: string;
  createdAt?: number;
  status?: string;
  reason?: CancelReason | string;
};

/** Minimal shape of an order row in the `["orders", wallet]` React Query cache. */
type OrderListRow = {
  orderId: string;
  status: string;
  filledAmount: string;
  reason?: string;
  [k: string]: unknown;
};

type OrderListPage = {
  orders: OrderListRow[];
  total?: number;
  limit?: number;
  offset?: number;
};

/**
 * Build an OrderListRow from a WS order_update frame. Returns null when the
 * payload lacks fields needed for a usable row (older backend builds prior
 * to the placement-emit enrichment). Only used when the cached list does
 * not yet contain this order id — see `applyOrderUpdateToList` below.
 *
 * Required wire fields: id, market, option, side, orderType, price, amount.
 * Backend WebSocketServer.ts pins this shape; see PR #41 for the placement
 * emit + payload enrichment that landed alongside this consumer.
 */
function rowFromUpdate(update: OrderUpdateLike): OrderListRow | null {
  if (!update.id || !update.market) return null;
  if (update.option == null || update.side == null) return null;
  if (update.orderType == null || update.price == null) return null;
  if (update.amount == null) return null;
  const rawCreated = update.createdAt;
  const createdMs =
    typeof rawCreated === "number" && Number.isFinite(rawCreated) && rawCreated > 0
      ? rawCreated
      : Date.now();
  const isoCreated = new Date(createdMs).toISOString();
  return {
    orderId: String(update.id),
    maker: update.maker ?? "",
    market: update.market,
    option: update.option,
    side: update.side,
    type: update.orderType,
    price: update.price,
    amount: update.amount,
    filledAmount: update.filledAmount ?? "0",
    status: String(update.status ?? "OPEN"),
    createdAt: isoCreated,
    updatedAt: isoCreated,
    ...(update.reason != null ? { reason: String(update.reason) } : {}),
  };
}

/**
 * Merge an incoming `order_update` WS frame into the cached orders-list response
 * so the UI reflects placements / fills / cancels in real time without waiting
 * for a 20s poll.
 *
 * - If the order id matches an existing row, patch in place (status, filledAmount, reason).
 * - If the id is unknown AND the payload carries enough fields to build a full
 *   row (Bug B placement-emit case), prepend it to the list.
 * - Otherwise return the input list reference unchanged so React Query no-ops.
 *
 * Backend WS sends `id` (see MatchingEngine emits); cache rows store `orderId`
 * (see GET /orders/:wallet response).
 */
export function applyOrderUpdateToList(
  list: OrderListPage | undefined,
  update: OrderUpdateLike,
): OrderListPage | undefined {
  if (!list || !Array.isArray(list.orders)) return list;
  const incomingId = update.id;
  if (!incomingId) return list;
  let mutated = false;
  const nextOrders = list.orders.map((o) => {
    if (o.orderId !== incomingId) return o;
    mutated = true;
    return {
      ...o,
      ...(update.status ? { status: String(update.status) } : {}),
      ...(update.filledAmount != null ? { filledAmount: String(update.filledAmount) } : {}),
      ...(update.reason != null ? { reason: String(update.reason) } : {}),
    };
  });
  if (mutated) return { ...list, orders: nextOrders };
  // Order not in cache — try to synthesize from the WS payload (Bug B: a fresh
  // LIMIT placement emit arrives before any GET /orders refetch can hydrate it).
  const synthesized = rowFromUpdate(update);
  if (!synthesized) return list;
  return { ...list, orders: [synthesized, ...list.orders] };
}

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
    const reason = data.reason as CancelReason | undefined;
    // Reason-specific copy. Older backend builds that don't send a reason fall
    // through to the "no liquidity" / "partial-then-cancelled" defaults below,
    // preserving prior behavior so a backend rollback doesn't break UX.
    if (reason === "MARKET_ENDED") {
      return {
        kind: "info",
        message: "Market ended — your order was cancelled, balance returned.",
        id,
      };
    }
    if (reason === "EXPIRED") {
      return { kind: "info", message: "Order expired — balance returned.", id };
    }
    if (reason === "USER_CANCEL") {
      return { kind: "info", message: "Order cancelled — balance returned.", id };
    }
    if (reason === "KILL_SWITCH") {
      return { kind: "info", message: "All your orders on this market were cancelled.", id };
    }
    if (reason === "SESSION_EXPIRED") {
      return { kind: "info", message: "Session expired — order cancelled, balance returned.", id };
    }
    // NO_LIQUIDITY (default for MARKET/IOC no-fill) OR no reason sent.
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

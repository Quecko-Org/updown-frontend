/**
 * Single-source helper for rendering a market's outcome / status across every
 * surface (home card, market detail page, portfolio resolved tab, market-closed
 * panel). Phase2-A consolidation — supersedes the earlier `formatResolutionOutcome`
 * shipped in PR #36 (lib/derivations.ts), which had a narrower return shape.
 *
 * Return shape is intentionally renderable-as-is — call sites should NOT
 * recompute deltas, rebuild labels from `winner` / `status`, or apply their
 * own status text mapping.
 */

import { formatStrikeUsd, parseStrikeUsdNumber } from "../format";

/** RESOLVED / CLAIMED = on-chain settlement final, winner determined. */
export function isResolvedMarketStatus(status: string | undefined | null): boolean {
  return status === "RESOLVED" || status === "CLAIMED";
}

/**
 * Terminal = no further trade activity is permitted on this market. Includes
 * TRADING_ENDED (countdown elapsed but settlement not yet final on-chain) — the
 * matching engine rejects new orders in this state. Trade panels, cancel buttons,
 * and order entry must gate on this.
 */
export function isTerminalMarketStatus(status: string | undefined | null): boolean {
  return (
    status === "RESOLVED" ||
    status === "CLAIMED" ||
    status === "TRADING_ENDED"
  );
}

export type MarketOutcome = {
  /** "UP won" / "DOWN won" — null if market hasn't resolved (winner === 0 or null). */
  winnerLabel: string | null;
  /** 1 = UP, 2 = DOWN, null if not yet resolved. */
  winnerSide: 1 | 2 | null;
  /** Formatted settlement price ($X,XXX.XX) — null when not yet settled. */
  settledPriceStr: string | null;
  /** Pretty-formatted delta percent (signed), null when no settlement price. */
  deltaStr: string | null;
  /** True when the rendered delta required extra precision (sub-cent gap). */
  deltaUsedFinePrecision: boolean;
  /** Display string for the market's lifecycle stage:
   *   ACTIVE         → "Live"
   *   TRADING_ENDED  → "Trading ended"
   *   RESOLVED/CLAIMED → "Resolved"
   *   anything else  → the raw status string, capitalised */
  statusLabel: string;
};

function formatStatusLabel(status: string | undefined | null): string {
  if (!status) return "—";
  if (status === "ACTIVE") return "Live";
  if (status === "TRADING_ENDED") return "Trading ended";
  if (status === "RESOLVED" || status === "CLAIMED") return "Resolved";
  // Fallback: lowercase + uppercase first char so unknown statuses don't read
  // as ALL_CAPS_SHOUTING in the UI.
  const s = String(status);
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Display-1 (sub-cent precision): when the rounded delta would render as
 * "+0.00%" but is non-zero, fall back to 4-decimal precision so the user can
 * see why DOWN won an apparent tie. The settlement rule on-chain is
 * `settled > strike => UP, settled <= strike => DOWN`, so a tie always
 * favors DOWN.
 */
export function formatResolutionOutcome(market: {
  status: string;
  winner: number | null;
  strikePrice?: string;
  settlementPrice?: string;
}): MarketOutcome {
  const isResolved = isResolvedMarketStatus(market.status);
  const winnerSide: 1 | 2 | null =
    isResolved && market.winner === 1 ? 1 : isResolved && market.winner === 2 ? 2 : null;
  const winnerLabel = winnerSide === 1 ? "UP won" : winnerSide === 2 ? "DOWN won" : null;

  const settledPriceStr = market.settlementPrice
    ? formatStrikeUsd(market.settlementPrice)
    : null;

  let deltaStr: string | null = null;
  let deltaUsedFinePrecision = false;
  // pr-fix-3 (2026-05-16) Issue 8a sibling: `Number(market.strikePrice)` on
  // a raw on-chain atomic value gave a number at the wrong scale (e.g.
  // 350000000000 = $3,500 strike at 1e8). The arithmetic below then
  // computed ((settled_1e18 − strike_1e8) / strike_1e8) × 100 ≈ 6.45e11 %.
  // Use `parseStrikeUsdNumber` to apply the canonical 1e8 divisor on
  // both sides before computing % delta. The 1e18-scale Settlement bug
  // (audited mismatch between Streams + Data Feeds oracles) is being
  // closed separately by pr-fix-4; until that lands, the % delta on
  // resolved markets will still be off when settlementPrice is 1e18,
  // but at least no longer 11 orders of magnitude wrong.
  const strike = parseStrikeUsdNumber(market.strikePrice);
  const settled = parseStrikeUsdNumber(market.settlementPrice);
  if (strike != null && settled != null && strike !== 0) {
    const pct = ((settled - strike) / strike) * 100;
    const sign = pct >= 0 ? "+" : "−";
    const abs = Math.abs(pct);
    if (abs > 0 && abs < 0.005) {
      deltaStr = `${sign}${abs.toFixed(4)}%`;
      deltaUsedFinePrecision = true;
    } else {
      deltaStr = `${sign}${abs.toFixed(2)}%`;
    }
  }

  return {
    winnerLabel,
    winnerSide,
    settledPriceStr,
    deltaStr,
    deltaUsedFinePrecision,
    statusLabel: formatStatusLabel(market.status),
  };
}

/**
 * F3: human-readable label for the market's trading window. Used in
 * Portfolio Resolved table + the YourActivityOnMarket "Filled positions"
 * subsection so users can disambiguate "which 5-min BTC market did I
 * trade?" at a glance.
 *
 * Format examples:
 *   "BTC 5min · Apr 28 14:30–14:35"
 *   "ETH 1h · Apr 28 14:00–15:00"
 *   "BTC 15min · Apr 28 14:00–14:15"
 *
 * Times are LOCAL to the user's browser. UTC would be more "correct"
 * for distributed users but local matches the at-a-glance use case
 * better — users compare these against memory of when they traded.
 */
export function formatMarketWindow(market: {
  startTime?: number;
  endTime?: number;
  duration?: number;
  pairId?: string;
  pairSymbol?: string;
}): string | null {
  if (!market.startTime || !market.endTime) return null;
  const pairBase =
    ((market.pairSymbol ?? market.pairId)?.split("-")[0] ?? "BTC").toUpperCase();
  const tfLabel = formatDurationShort(market.duration);
  const start = new Date(market.startTime * 1000);
  const end = new Date(market.endTime * 1000);
  const date = start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const startStr = start.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const endStr = end.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${pairBase} ${tfLabel} · ${date} ${startStr}–${endStr}`;
}

function formatDurationShort(duration?: number): string {
  if (duration === 300) return "5min";
  if (duration === 900) return "15min";
  if (duration === 3600) return "1h";
  if (typeof duration !== "number" || duration <= 0) return "—";
  if (duration < 60) return `${duration}s`;
  if (duration < 3600) return `${Math.round(duration / 60)}min`;
  return `${Math.round(duration / 3600)}h`;
}

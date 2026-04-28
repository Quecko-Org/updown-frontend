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

import { formatStrikeUsd } from "../format";

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
  const strike = market.strikePrice ? Number(market.strikePrice) : NaN;
  const settled = market.settlementPrice ? Number(market.settlementPrice) : NaN;
  if (Number.isFinite(strike) && Number.isFinite(settled) && strike !== 0) {
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

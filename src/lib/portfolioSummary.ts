import type { PositionRow } from "./api";
import { isResolvedMarketStatus, isTerminalMarketStatus } from "./derivations";

/** Parse an atomic-units string to BigInt, tolerating null/garbage as 0 so a
 *  malformed row can never throw and blank the whole summary. */
export function safeBigInt(s: string | undefined | null): bigint {
  try {
    return BigInt(s ?? "0");
  } catch {
    return BigInt(0);
  }
}

export type PortfolioSummaryData = {
  /** Atomic USDT invested in still-active (non-terminal) positions. */
  invested: string;
  activeCount: number;
  /** COMPLETE realized P&L (atomic USDT, signed): the settlement term over
   *  positions held to resolution PLUS the manual-sell term. Never split. */
  realizedPnL: bigint;
  winRate: number | null;
  totalResolved: number;
  /** Whether the Realized P&L cell has a number to show (vs "—"): true when a
   *  position resolved OR realized was booked on a sell. */
  hasRealized: boolean;
};

/**
 * Roll the position feed up into the four summary numbers on the portfolio
 * header. Realized P&L is the SUM of two terms that must never be shown apart:
 *
 *  1. the settlement term — P&L realized when a position the user still HELD
 *     resolved (win → shares − cost, loss → −cost), derived from these rows and
 *     `winnerByMarket`; and
 *  2. `realizedFromSells` — the atomic-USDT scalar the backend returns for P&L
 *     booked on manual market-SELLs (`?includeRealized=1`). It lives on
 *     positions that closed to zero shares and were dropped from these rows, so
 *     it cannot be recovered here — it is handed in and added.
 *
 * Only the combined figure is order-invariant (the backend books per-sell
 * realized at average cost), so `realizedFromSells` is never surfaced alone.
 */
export function computeSummary(
  positions: PositionRow[],
  winnerByMarket: Map<string, number | null>,
  realizedFromSells?: string | null,
): PortfolioSummaryData {
  let invested = BigInt(0);
  let activeCount = 0;
  let realizedPnL = BigInt(0);
  let wins = 0;
  let losses = 0;

  for (const p of positions) {
    const cost = safeBigInt(p.costBasis);
    const shares = safeBigInt(p.shares);
    if (shares === BigInt(0)) continue;

    if (!isTerminalMarketStatus(p.marketStatus)) {
      invested += cost;
      activeCount += 1;
      continue;
    }

    if (isResolvedMarketStatus(p.marketStatus)) {
      const winner = winnerByMarket.get(p.market.toLowerCase()) ?? null;
      if (winner === 0 || winner == null) continue;
      if (p.option === winner) {
        // Winning side pays out 1 USDT per share. shares is in atomic USDT
        // (decimals match) so payout = shares; pnl = shares - cost.
        realizedPnL += shares - cost;
        wins += 1;
      } else {
        realizedPnL -= cost;
        losses += 1;
      }
    }
  }

  // Fold in the manual-sell realized term. `realizedPnL` is now the COMPLETE
  // realized figure; the settlement and sell terms are never displayed apart.
  const sellsRealized = safeBigInt(realizedFromSells);
  realizedPnL += sellsRealized;

  const totalResolved = wins + losses;
  const winRate = totalResolved === 0 ? null : Math.round((wins / totalResolved) * 100);
  // Show a Realized P&L number when there is ANY realized signal — a position
  // held to resolution OR P&L booked on a manual sell. Gating only on
  // `totalResolved` would hide real realized P&L for a wallet that sold out of
  // everything before its markets resolved (the same discard, one layer up).
  // Win rate stays gated on resolved held positions — a sell has no outcome.
  const hasRealized = totalResolved > 0 || sellsRealized !== BigInt(0);

  return {
    invested: invested.toString(),
    activeCount,
    realizedPnL,
    winRate,
    totalResolved,
    hasRealized,
  };
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { getOrderbook, type OrderBookResponse } from "@/lib/api";
import { computeImpliedProb, type ImpliedProb } from "@/lib/format";

/**
 * PR-5 — replace the pool-ratio implied-prob placeholder (PR-4) with a
 * proper orderbook-mid for ACTIVE markets.
 *
 * Math: implied UP probability = mid(bestUpBid, bestUpAsk) / 100.
 * Prices on the wire are in basis points (10_000 = 100%) per OrderBook.tsx
 * convention. Mid is the standard CLOB-derived probability — what
 * Polymarket displays as "X% chance" on every market card.
 *
 * Fallback ladder when the orderbook isn't enough signal:
 *
 *   1. orderbook mid available on UP side  → use it (canonical)
 *   2. one-sided orderbook (only bids OR only asks) → use that price alone
 *   3. orderbook empty + pool data available → fall back to pool ratios
 *      via `computeImpliedProb` (PR-4 behavior, the historical placeholder)
 *   4. nothing available → `{ upPct: null, downPct: null }` — row renders
 *      "—" rather than a misleading 50%.
 *
 * Caller passes `upPool` + `downPool` so step 3 has signal to use.
 *
 * Refresh cadence: 5s stale + 5s refetch interval. Same as TradeForm's
 * orderbook poll. WS streaming is a future optimization — the orderbook
 * endpoint is dirt-cheap and a per-row poll is fine for the current
 * 50-market homepage.
 */
export interface UseMarketImpliedProbArgs {
  /** Market composite address (the same id passed to getOrderbook). */
  marketId: string | null | undefined;
  /** Pool totals for the fallback when orderbook is empty. Same shape as MarketListItem. */
  upPool?: string | null;
  downPool?: string | null;
  /** Disable the query — used when the market isn't ACTIVE (the only
   *  state where orderbook makes sense). */
  enabled?: boolean;
}

export interface UseMarketImpliedProbResult {
  upPct: number | null;
  downPct: number | null;
  /** Where the number came from — useful for QA / future analytics. */
  source: "orderbook-mid" | "orderbook-one-sided" | "pool-fallback" | "none";
}

/** Best bid (highest price someone is willing to pay) on a side. */
function bestBid(asksOrBids: { price: number }[]): number | null {
  if (asksOrBids.length === 0) return null;
  return Math.max(...asksOrBids.map((l) => l.price));
}

/** Best ask (lowest price someone is willing to sell at) on a side. */
function bestAsk(asksOrBids: { price: number }[]): number | null {
  if (asksOrBids.length === 0) return null;
  return Math.min(...asksOrBids.map((l) => l.price));
}

function bpsToPct(bps: number): number {
  // 10_000 bps = 100%. Round to integer percent for row display — the
  // detail-page chart can show finer precision when needed.
  return Math.round(bps / 100);
}

export function useMarketImpliedProb(
  args: UseMarketImpliedProbArgs,
): UseMarketImpliedProbResult {
  const { marketId, upPool, downPool, enabled = true } = args;

  const { data } = useQuery<OrderBookResponse>({
    queryKey: ["orderbook", marketId],
    queryFn: () => getOrderbook(marketId!),
    enabled: enabled && !!marketId,
    staleTime: 5_000,
    refetchInterval: 5_000,
    retry: 1,
  });

  // ── Step 1 + 2: orderbook signal ──
  if (data) {
    const upBid = bestBid(data.up.bids);
    const upAsk = bestAsk(data.up.asks);

    if (upBid != null && upAsk != null) {
      const midBps = (upBid + upAsk) / 2;
      const upPct = bpsToPct(midBps);
      return { upPct, downPct: 100 - upPct, source: "orderbook-mid" };
    }
    if (upBid != null) {
      const upPct = bpsToPct(upBid);
      return { upPct, downPct: 100 - upPct, source: "orderbook-one-sided" };
    }
    if (upAsk != null) {
      const upPct = bpsToPct(upAsk);
      return { upPct, downPct: 100 - upPct, source: "orderbook-one-sided" };
    }
  }

  // ── Step 3: pool fallback ──
  if (upPool && downPool) {
    const pool: ImpliedProb | null = computeImpliedProb(upPool, downPool);
    if (pool) {
      return { upPct: pool.upPct, downPct: pool.downPct, source: "pool-fallback" };
    }
  }

  // ── Step 4: no signal ──
  return { upPct: null, downPct: null, source: "none" };
}

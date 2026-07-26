"use client";

import { useQuery } from "@tanstack/react-query";
import { getMarketPrices, getPriceHistory } from "@/lib/api";
import { normalizePriceHistoryData } from "@/lib/priceChart";

/**
 * Live spot price for the header asset pill.
 *
 * ## Why this is not just a poll
 *
 * The pill used to call `getPriceHistory(symbol)` on a 30s `refetchInterval`.
 * That was wrong twice over:
 *
 *  1. **Wrong feed.** `/prices/history/:symbol` proxied Coinbase 1-minute
 *     candles directly, so the header showed a different price source from the
 *     chart right beside it and from the price markets actually settle on.
 *     (Fixed backend-side 2026-07-26 — that route now reads the same stored
 *     series. Kept here only as the no-live-market fallback.)
 *  2. **Wrong freshness.** A 30s poll of 1-minute candles is up to ~90s stale.
 *     In the screenshot that started this, the header read $64,428 while the
 *     chart's "Current" read $64,506.
 *
 * Primary source is now the live market's own series under
 * `["marketPrices", address]` — the identical cache entry `MarketPriceChart`
 * renders, which `useUpDownWebSocket` appends to on every `price_snapshot`
 * frame from the always-on `markets` channel. The header and the chart read one
 * array, so they cannot disagree: no extra request, no second feed, no lag.
 *
 * Falls back to the symbol-wide endpoint only when there is no live market
 * (cycler paused, or between slots) so the pill does not blank out.
 */
export function useLiveSpot(
  symbol: "BTC" | "ETH",
  liveMarketAddress: string | null,
  marketStartSec?: number,
  marketEndSec?: number,
): number | null {
  const addrLower = liveMarketAddress?.toLowerCase() ?? null;

  // Same queryKey as MarketPriceChart on purpose: whichever mounts first pays
  // for the fetch, both get every WS tick, and they render the same number.
  // The slow refetch is a safety net for missed frames, matching the chart.
  const { data: marketSeries } = useQuery({
    queryKey: ["marketPrices", addrLower],
    queryFn: () => getMarketPrices(addrLower!, marketStartSec, marketEndSec),
    enabled: addrLower != null,
    refetchInterval: 30_000,
  });

  const { data: fallback } = useQuery({
    queryKey: ["spot", symbol],
    queryFn: async () => {
      const points = normalizePriceHistoryData(await getPriceHistory(symbol));
      return points.length ? points[points.length - 1].p : null;
    },
    // Only runs while no live market exists. Slower than the old 30s because
    // it is now a genuine fallback, not the primary path.
    enabled: addrLower == null,
    refetchInterval: 60_000,
  });

  if (addrLower != null) {
    const points = normalizePriceHistoryData(marketSeries);
    if (points.length) return points[points.length - 1].p;
    // Live market known but its series has not landed yet (first paint, or a
    // market that started while the backend was down and so has no history
    // before its first tick). Show nothing rather than a stale number.
    return null;
  }
  return fallback ?? null;
}

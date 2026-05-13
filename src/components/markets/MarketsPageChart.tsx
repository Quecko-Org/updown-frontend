"use client";

import { MarketPriceChart } from "@/components/MarketPriceChart";
import type { MarketListItem } from "@/lib/api";

export type MarketsPageChartProps = {
  asset: "btc" | "eth";
  timeframe: "5m" | "15m" | "60m";
  /**
   * The bucketed live market for the selected pair+timeframe, picked by the
   * page component from the markets list. The chart series is per-market
   * (Chainlink history with one-shot Coinbase backfill, plus WebSocket-pushed
   * live ticks); when there is no live market this prop is null and we fall
   * back to a quiet placeholder so the page layout doesn't jump.
   */
  liveMarket: MarketListItem | null;
};

/**
 * Thin wrapper around the existing <MarketPriceChart> with two purposes:
 *   1. Normalize the lowercase `asset` prop the new page uses into the
 *      uppercase `"BTC" | "ETH"` symbol the underlying chart expects.
 *   2. Resolve the chart's market-keyed inputs from a single liveMarket
 *      prop so the page composition stays free of chart-specific plumbing.
 *
 * Strike-line + settlement-line overlays are already native on the
 * underlying chart (`strikePriceRaw` / `settlementPriceRaw`); we just map
 * them through.
 */
export function MarketsPageChart({ asset, timeframe, liveMarket }: MarketsPageChartProps) {
  if (!liveMarket) {
    return (
      <div
        className="pp-state-card"
        style={{ minHeight: 280, justifyContent: "center" }}
        data-testid="markets-page-chart-empty"
      >
        <p className="pp-state-card__body">
          {asset.toUpperCase()} {timeframe.toUpperCase()} chart will populate when the
          next market opens.
        </p>
      </div>
    );
  }

  return (
    <MarketPriceChart
      symbol={asset === "btc" ? "BTC" : "ETH"}
      marketAddress={liveMarket.address}
      marketStartSec={liveMarket.startTime}
      marketEndSec={liveMarket.endTime}
      strikePriceRaw={liveMarket.strikePrice}
      settlementPriceRaw={liveMarket.settlementPrice}
      isResolved={liveMarket.status !== "ACTIVE"}
    />
  );
}

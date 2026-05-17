"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useAccount } from "wagmi";
import { getMarket, getPositions, getDmmStatus } from "@/lib/api";
import { formatStrikeUsd, marketDurationLabel } from "@/lib/format";
import { parseCompositeMarketKey } from "@/lib/marketKey";
import {
  formatMarketWindow,
  formatResolutionOutcome,
  isTerminalMarketStatus,
} from "@/lib/derivations";
import { ImpliedProbStrip } from "@/components/ImpliedProbStrip";
import { MarketPriceChart } from "@/components/MarketPriceChart";
import { TradeForm } from "@/components/TradeForm";
import { OrderBookPanel } from "@/components/OrderBook";
import { YourActivityOnMarket } from "@/components/YourActivityOnMarket";
import { EmptyState } from "@/components/EmptyState";
import { CancelAllMarketOrders } from "@/components/CancelAllMarketOrders";
import { MarketHeaderActions } from "@/components/MarketHeaderActions";
import { TimeRangeStrip } from "@/components/TimeRangeStrip";
import { formatUsdt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { userSmartAccount } from "@/store/atoms";

function useEndsInCountdown(endTimeSec: number) {
  const [left, setLeft] = useState(() =>
    endTimeSec > 0 ? Math.max(0, endTimeSec - Math.floor(Date.now() / 1000)) : 0,
  );
  useEffect(() => {
    if (!endTimeSec) {
      setLeft(0);
      return;
    }
    setLeft(Math.max(0, endTimeSec - Math.floor(Date.now() / 1000)));
    const t = setInterval(() => {
      setLeft(Math.max(0, endTimeSec - Math.floor(Date.now() / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [endTimeSec]);
  const m = Math.floor(left / 60);
  const s = left % 60;
  if (!endTimeSec) return "—";
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function MarketPageClient({ address }: { address: string }) {
  const { address: eoa, isConnected } = useAccount();
  const smartAccount = useAtomValue(userSmartAccount);

  const parsed = useMemo(() => parseCompositeMarketKey(address), [address]);
  const marketKey = parsed?.composite ?? address;

  const { data: market, isLoading } = useQuery({
    queryKey: ["market", marketKey.toLowerCase()],
    queryFn: () => getMarket(marketKey),
    enabled: !!parsed,
    refetchInterval: 15_000,
  });

  const chartSymbol = market?.chartSymbol === "ETH" ? "ETH" : "BTC";

  // PR-20 Phase 2: the symbol-wide spot price feed (`getPriceHistory`) is
  // gone — the market-detail chart now sources its series from the
  // per-market `getMarketPrices` endpoint inside MarketPriceChart, fed live
  // by the `market_price_snapshot` WS frame. The page's only price-related
  // job is to choose the chart symbol label.

  const { data: positions } = useQuery({
    queryKey: ["positions", smartAccount?.toLowerCase() ?? ""],
    queryFn: () => getPositions(smartAccount!),
    enabled: !!smartAccount && isConnected,
    refetchInterval: 20_000,
    retry: 1,
  });

  const { data: dmmStatus } = useQuery({
    queryKey: ["dmmStatus", eoa?.toLowerCase() ?? ""],
    queryFn: () => getDmmStatus(eoa!),
    enabled: !!eoa,
    staleTime: 60_000,
  });

  const endsIn = useEndsInCountdown(market?.endTime ?? 0);

  const localPositions =
    positions?.filter((p) => p.market.toLowerCase() === marketKey.toLowerCase()) ?? [];

  if (!parsed) {
    return (
      <div className="pp-market-detail pp-market-detail--empty">
        <Link href="/" className="pp-back">
          ← Markets
        </Link>
        <EmptyState
          icon="chart"
          title="Invalid market link"
          subtitle="This URL does not match a valid market key (settlement address and market id)."
        />
      </div>
    );
  }

  if (isLoading || !market) {
    return <div className="pp-market-detail__loading pp-caption">Loading…</div>;
  }

  const strikeLabel = formatStrikeUsd(market.strikePrice, market.strikeDecimals);
  const pairBase = (market.pairSymbol ?? market.pairId).split("-")[0] ?? "BTC";
  const pairLabel = `${pairBase}/USD`;
  const tfLabel = marketDurationLabel(market.duration);
  const heroTitle = `${pairLabel} · ${tfLabel}`;

  // Bug C: pre-fix, "Currently" always rendered live spot vs strike — for
  // RESOLVED markets this contradicted the home page card's winner badge once
  // spot had drifted past strike post-resolve. Now use the canonical
  // formatResolutionOutcome helper for resolved markets and drop "Currently".
  const resolution = formatResolutionOutcome(market);
  const isResolvedView = resolution.winnerSide != null;
  const settledLabel = market.settlementPrice ? formatStrikeUsd(market.settlementPrice, market.strikeDecimals) : null;

  // PR-18 OBS-2: removed "Currently UP ▲ / DOWN ▼" arrow that derived
  // direction from spot vs strike. Polymarket has no equivalent — they
  // surface implied probability only, not a parallel directional badge.
  // The implied-probability bar already covers directional sentiment;
  // the arrow duplicated and confused. spotUsd / strikeNum keep their
  // other consumers (chart anchor, header readouts).

  // Phase2-PRE: even DMMs can't cancel-all on a terminal market — orders are
  // already cancelled by the matching engine at MARKET_ENDED. Hide the kill
  // switch so it doesn't fire a no-op DELETE that the backend would reject.
  const showCancelAll =
    !!eoa && dmmStatus?.isDmm && !isTerminalMarketStatus(market.status);

  return (
    <div className="pp-market-detail">
      {/* Top bar: ← Markets, header-actions cluster. Mirrors the home page
          subnav pattern. */}
      <div className="pp-market-detail__topbar">
        <Link href="/" className="pp-back">
          ← Markets
        </Link>
        <MarketHeaderActions marketKey={marketKey} marketAddress={market.address} />
      </div>

      {/* Hero: pair · timeframe heading + per-metric tile row (Strike / Ends in
          / Volume / Status). Mirrors the home-page `pp-tile` visual language
          so the surface reads as the same product as the markets list. */}
      <header className="pp-market-detail__hero">
        <h1 className="pp-market-detail__hero-title">{heroTitle}</h1>
        <div className="pp-market-detail__stats">
          {isResolvedView ? (
            <>
              <div className="pp-market-detail__stat">
                <span className="pp-micro">Price To Beat</span>
                <span className="pp-market-detail__stat-value pp-tabular">{strikeLabel}</span>
              </div>
              <div className="pp-market-detail__stat">
                <span className="pp-micro">Settled Price</span>
                <span
                  className={cn(
                    "pp-market-detail__stat-value pp-tabular",
                    resolution.winnerSide === 1 && "pp-market-detail__stat-value--up",
                    resolution.winnerSide === 2 && "pp-market-detail__stat-value--down",
                  )}
                >
                  {resolution.winnerSide === 1 ? "▲ " : resolution.winnerSide === 2 ? "▼ " : ""}
                  {settledLabel ?? "—"}
                </span>
                {resolution.deltaStr ? (
                  <span
                    className="pp-market-detail__stat-sub pp-tabular"
                    title={
                      resolution.deltaUsedFinePrecision
                        ? "Sub-cent gap — extra precision shown so the result is unambiguous"
                        : undefined
                    }
                  >
                    {resolution.deltaStr}
                  </span>
                ) : null}
              </div>
              <div className="pp-market-detail__stat">
                <span className="pp-micro">Volume</span>
                <span className="pp-market-detail__stat-value pp-tabular">
                  ${formatUsdt(market.volume ?? "0")}
                </span>
              </div>
              <div className="pp-market-detail__stat">
                <span className="pp-micro">Status</span>
                <span className="pp-chip pp-chip--closed">
                  <span className="pp-tabular">RESOLVED</span>
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="pp-market-detail__stat">
                <span className="pp-micro">Strike</span>
                <span className="pp-market-detail__stat-value pp-tabular">{strikeLabel}</span>
              </div>
              <div className="pp-market-detail__stat">
                <span className="pp-micro">Ends in</span>
                <span className="pp-market-detail__stat-value pp-tabular">{endsIn}</span>
              </div>
              <div className="pp-market-detail__stat">
                <span className="pp-micro">Volume</span>
                <span className="pp-market-detail__stat-value pp-tabular">
                  ${formatUsdt(market.volume ?? "0")}
                </span>
              </div>
              <div className="pp-market-detail__stat">
                <span className="pp-micro">Status</span>
                <span className="pp-chip pp-chip--cd">
                  <span className="pp-tabular">{market.status}</span>
                </span>
              </div>
            </>
          )}
        </div>
        {showCancelAll ? (
          <div className="pp-market-detail__hero-actions">
            <CancelAllMarketOrders marketComposite={marketKey} />
          </div>
        ) : null}
      </header>

      {/* Body: left = chart + prob strip + time range + order book; right =
          sticky TradeForm v2. Mobile collapses to a single column stack. */}
      <div className="pp-market-detail__body">
        <div className="pp-market-detail__left">
          <MarketPriceChart
            symbol={chartSymbol}
            marketAddress={market.address}
            marketStartSec={market.startTime}
            marketEndSec={market.endTime}
            strikePriceRaw={market.strikePrice}
            strikeDecimals={market.strikeDecimals}
            settlementPriceRaw={market.settlementPrice}
            isResolved={market.status === "RESOLVED" || market.status === "CLAIMED"}
          />
          {/* Phase2-G: implied-probability snapshot from order-book mid.
              Resolved markets hide it — the outcome is final, not a probability. */}
          {!isTerminalMarketStatus(market.status) ? (
            <ImpliedProbStrip market={market} />
          ) : null}
          {/* Phase2-B: outcome history + upcoming windows strip below the
              chart. Provides at-a-glance context for the current window and
              one-click jump to past or near-future markets in the same series. */}
          <TimeRangeStrip
            pairId={market.pairId}
            duration={market.duration}
            currentMarketAddress={market.address}
          />
          <section className="pp-market-detail__section">
            <h2 className="pp-market-detail__section-title">Order book</h2>
            <OrderBookPanel marketId={marketKey} marketStatus={market.status} />
          </section>
        </div>
        <div className="pp-market-detail__right">
          <TradeForm marketAddress={marketKey} />
        </div>
      </div>

      {/* Phase2-A: combined "Your activity in this market" panel — replaces
          the old MyOrdersOnMarket-in-trade-form-rail + separate "Your positions"
          section. Single panel with two subsections (Open orders, Filled
          positions) so the user has one place to look. */}
      <YourActivityOnMarket
        marketWindowLabel={formatMarketWindow(market)}
        marketComposite={marketKey}
        smartAccount={smartAccount}
        positions={localPositions}
        marketStatus={market?.status ?? null}
      />
    </div>
  );
}

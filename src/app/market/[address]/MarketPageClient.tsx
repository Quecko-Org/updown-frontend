"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useAccount } from "wagmi";
import { getMarket, getPositions, getDmmStatus } from "@/lib/api";
import { marketDurationLabel } from "@/lib/format";
import { parseCompositeMarketKey } from "@/lib/marketKey";
import {
  formatMarketWindow,
  isTerminalMarketStatus,
} from "@/lib/derivations";
import { ImpliedProbStrip } from "@/components/ImpliedProbStrip";
import { MarketPriceChart } from "@/components/MarketPriceChart";
import { TradeForm } from "@/components/TradeForm";
import { OrderBookDrawer } from "@/components/markets/OrderBookDrawer";
import { YourActivityOnMarket } from "@/components/YourActivityOnMarket";
import { EmptyState } from "@/components/EmptyState";
import { CancelAllMarketOrders } from "@/components/CancelAllMarketOrders";
import { MarketHeaderActions } from "@/components/MarketHeaderActions";
import { TimeRangeStrip } from "@/components/TimeRangeStrip";
import { userSmartAccount } from "@/store/atoms";

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

  const pairBase = (market.pairSymbol ?? market.pairId).split("-")[0] ?? "BTC";
  const pairLabel = `${pairBase}/USD`;
  const tfLabel = marketDurationLabel(market.duration);
  const heroTitle = `${pairLabel} · ${tfLabel}`;

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

      {/* 2026-05-17 UX redesign: the prior 4-stat tile row (Strike / Ends in
          / Volume / Status) is gone. Strike + countdown + status are all
          already surfaced inside TradeForm; the chart shows the strike
          line. The duplicate tile row added visual noise without adding
          information. Heading kept as a slim crumb for deep-link context. */}
      <header className="pp-market-detail__hero">
        <h1 className="pp-market-detail__hero-title">{heroTitle}</h1>
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
          {/* Order book moved to a collapsible drawer — matches the home
              page surface. Closed by default; click the chevron to reveal. */}
          <OrderBookDrawer marketId={marketKey} marketStatus={market.status} />
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

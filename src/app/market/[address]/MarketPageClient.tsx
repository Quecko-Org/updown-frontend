"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useAccount } from "wagmi";
import { getMarket, getPositions, getPriceHistory, getDmmStatus } from "@/lib/api";
import { formatStrikeUsd, marketDurationLabel, parseStrikeUsdNumber } from "@/lib/format";
import { normalizePriceHistoryData } from "@/lib/priceChart";
import { parseCompositeMarketKey } from "@/lib/marketKey";
import {
  formatMarketWindow,
  formatResolutionOutcome,
  isTerminalMarketStatus,
} from "@/lib/derivations";
import { MarketPriceChart } from "@/components/MarketPriceChart";
import { TradeForm } from "@/components/TradeForm";
import { OrderBookPanel } from "@/components/OrderBook";
import { YourActivityOnMarket } from "@/components/YourActivityOnMarket";
import { EmptyState } from "@/components/EmptyState";
import { CancelAllMarketOrders } from "@/components/CancelAllMarketOrders";
import { TimeRangeStrip } from "@/components/TimeRangeStrip";
import { formatUsdt } from "@/lib/format";
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

  const { data: priceRaw } = useQuery({
    queryKey: ["priceHistory", chartSymbol],
    queryFn: () => getPriceHistory(chartSymbol),
    enabled: !!market,
    refetchInterval: 10_000,
  });

  const spotUsd = useMemo(() => {
    const pts = normalizePriceHistoryData(priceRaw);
    if (!pts.length) return null;
    const p = pts[pts.length - 1]!.p;
    return p > 0 ? p : null;
  }, [priceRaw]);

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
      <div className="space-y-4">
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
    return (
      <div
        className="flex min-h-[30vh] items-center justify-center rounded-[6px] border border-dashed pp-caption"
        style={{ borderColor: "var(--border-0)" }}
      >
        Loading…
      </div>
    );
  }

  const strikeLabel = formatStrikeUsd(market.strikePrice);
  const strikeNum = parseStrikeUsdNumber(market.strikePrice);
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
  const settledLabel = market.settlementPrice ? formatStrikeUsd(market.settlementPrice) : null;

  const directionLabel =
    strikeNum == null || spotUsd == null
      ? "—"
      : spotUsd >= strikeNum
        ? "UP ▲"
        : "DOWN ▼";
  const directionColor =
    strikeNum == null || spotUsd == null
      ? "var(--fg-2)"
      : spotUsd >= strikeNum
        ? "var(--up)"
        : "var(--down)";

  // Phase2-PRE: even DMMs can't cancel-all on a terminal market — orders are
  // already cancelled by the matching engine at MARKET_ENDED. Hide the kill
  // switch so it doesn't fire a no-op DELETE that the backend would reject.
  const showCancelAll =
    !!eoa && dmmStatus?.isDmm && !isTerminalMarketStatus(market.status);

  return (
    <div>
      <Link href="/" className="pp-back">
        ← Markets
      </Link>

      {/* Phase2-B header redesign: two-tier Polymarket-parity layout for
          RESOLVED markets — "Price To Beat" + "Settled Price ▼/▲ Δ$ value".
          Active markets keep the existing Strike/Ends in/Currently/Status
          layout until Phase2-C redesigns the live state. */}
      <header
        className="flex flex-wrap items-start justify-between gap-4 border-b pb-4"
        style={{ borderColor: "var(--border-0)" }}
      >
        <div className="min-w-0 flex-1">
          <h1 className="pp-h1">{heroTitle}</h1>
          {isResolvedView ? (
            <div className="mt-3 flex flex-wrap items-baseline gap-x-10 gap-y-3">
              <span className="flex flex-col gap-1">
                <span className="pp-micro">Price To Beat</span>
                <span className="pp-price-md pp-tabular">{strikeLabel}</span>
              </span>
              <span className="flex flex-col gap-1">
                <span className="pp-micro">Settled Price</span>
                <span
                  className="pp-price-md pp-tabular"
                  style={{
                    color:
                      resolution.winnerSide === 1
                        ? "var(--up)"
                        : resolution.winnerSide === 2
                          ? "var(--down)"
                          : "var(--fg-1)",
                  }}
                >
                  {resolution.winnerSide === 1
                    ? "▲ "
                    : resolution.winnerSide === 2
                      ? "▼ "
                      : ""}
                  {settledLabel ?? "—"}
                  {resolution.deltaStr ? (
                    <span
                      className="pp-caption pp-tabular"
                      style={{ color: "var(--fg-2)", marginLeft: 8, fontWeight: 400 }}
                      title={
                        resolution.deltaUsedFinePrecision
                          ? "Sub-cent gap — extra precision shown so the result is unambiguous"
                          : undefined
                      }
                    >
                      ({resolution.deltaStr})
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="flex flex-col gap-1">
                <span className="pp-micro">Volume</span>
                <span className="pp-price-md pp-tabular">
                  ${formatUsdt(market.volume ?? "0")}
                </span>
              </span>
              <span className="flex flex-col gap-1">
                <span className="pp-micro">Status</span>
                <span className="pp-chip pp-chip--closed">
                  <span className="pp-tabular">RESOLVED</span>
                </span>
              </span>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <span className="flex flex-col gap-1">
                <span className="pp-micro">Strike</span>
                <span className="pp-price-md">{strikeLabel}</span>
              </span>
              <span className="flex flex-col gap-1">
                <span className="pp-micro">Ends in</span>
                <span className="pp-price-md">{endsIn}</span>
              </span>
              <span className="flex flex-col gap-1">
                <span className="pp-micro">Currently</span>
                <span className="pp-price-md" style={{ color: directionColor }}>
                  {directionLabel}
                </span>
              </span>
              <span className="flex flex-col gap-1">
                <span className="pp-micro">Volume</span>
                <span className="pp-price-md pp-tabular">
                  ${formatUsdt(market.volume ?? "0")}
                </span>
              </span>
              <span className="flex flex-col gap-1">
                <span className="pp-micro">Status</span>
                <span className="pp-chip pp-chip--cd">
                  <span className="pp-tabular">{market.status}</span>
                </span>
              </span>
            </div>
          )}
        </div>
        {showCancelAll ? <CancelAllMarketOrders marketComposite={marketKey} /> : null}
      </header>

      {/* Contract hash */}
      <details className="mt-2">
        <summary className="pp-hash cursor-pointer select-none" style={{ color: "var(--fg-2)" }}>
          Contract
        </summary>
        <p className="pp-hash mt-1 break-all" style={{ color: "var(--fg-2)" }}>
          {market.address}
        </p>
      </details>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_minmax(300px,380px)] lg:items-start">
        <div className="min-w-0 space-y-3">
          <MarketPriceChart
            symbol={chartSymbol}
            marketStartSec={market.startTime}
            marketEndSec={market.endTime}
            strikePriceRaw={market.strikePrice}
            settlementPriceRaw={market.settlementPrice}
            isResolved={market.status === "RESOLVED" || market.status === "CLAIMED"}
          />
          {/* Phase2-B: outcome history + upcoming windows strip below the
              chart. Provides at-a-glance context for the current window and
              one-click jump to past or near-future markets in the same series. */}
          <TimeRangeStrip
            pairId={market.pairId}
            duration={market.duration}
            currentMarketAddress={market.address}
          />
          <section>
            <h2 className="pp-micro mb-2">Order book</h2>
            <OrderBookPanel marketId={marketKey} marketStatus={market.status} />
          </section>
        </div>
        <div className="lg:sticky lg:top-20">
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
      />
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useAccount } from "wagmi";
import { getMarket, getPositions, getPriceHistory, getDmmStatus } from "@/lib/api";
import { formatStrikeUsd, formatUsdt, marketDurationLabel, parseStrikeUsdNumber } from "@/lib/format";
import { normalizePriceHistoryData } from "@/lib/priceChart";
import { parseCompositeMarketKey } from "@/lib/marketKey";
import { MarketPriceChart } from "@/components/MarketPriceChart";
import { TradeForm } from "@/components/TradeForm";
import { OrderBookPanel } from "@/components/OrderBook";
import { MyOrdersOnMarket } from "@/components/MyOrdersOnMarket";
import { EmptyState } from "@/components/EmptyState";
import { CancelAllMarketOrders } from "@/components/CancelAllMarketOrders";
import { WalletConnectorList } from "@/components/WalletConnectorList";
import { cn } from "@/lib/cn";
import { sessionReadyAtom, userSmartAccount } from "@/store/atoms";

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
  const sessionReady = useAtomValue(sessionReadyAtom);

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
    enabled: !!smartAccount && isConnected && sessionReady,
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
        <Link href="/" className="text-xs font-semibold text-brand hover:underline">
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
      <div className="flex min-h-[30vh] items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted">
        Loading…
      </div>
    );
  }

  const strikeLabel = formatStrikeUsd(market.strikePrice);
  const strikeNum = parseStrikeUsdNumber(market.strikePrice);
  const pairLabel = (market.pairSymbol ?? market.pairId).replace("-", " / ");
  const heroTitle = `${pairLabel} · ${marketDurationLabel(market.duration)}`;

  const currentLabel =
    strikeNum == null || spotUsd == null
      ? "Currently —"
      : spotUsd >= strikeNum
        ? "Currently UP ▲"
        : "Currently DOWN ▼";

  const showCancelAll = !!eoa && dmmStatus?.isDmm;

  return (
    <div className="space-y-4">
      <Link href="/" className="text-xs font-semibold text-brand hover:underline">
        ← Markets
      </Link>

      <header className="space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">{heroTitle}</h1>
          {showCancelAll ? <CancelAllMarketOrders marketComposite={marketKey} /> : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted">
          <span>
            Price to Beat: <span className="font-semibold text-foreground">{strikeLabel}</span>
          </span>
          <span aria-hidden>·</span>
          <span>
            Ends in <span className="font-mono font-semibold text-foreground">{endsIn}</span>
          </span>
          <span aria-hidden>·</span>
          <span
            className={cn(
              "font-semibold",
              strikeNum == null || spotUsd == null
                ? "text-muted"
                : spotUsd >= strikeNum
                  ? "text-success"
                  : "text-down",
            )}
          >
            {currentLabel}
          </span>
        </p>
        <details className="text-[10px] text-muted">
          <summary className="cursor-pointer select-none hover:text-foreground">Contract</summary>
          <p className="mt-1 break-all font-mono">{market.address}</p>
        </details>
      </header>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_minmax(280px,380px)] lg:items-start">
        <div className="min-w-0 space-y-3">
          <MarketPriceChart
            symbol={chartSymbol}
            marketStartSec={market.startTime}
            marketEndSec={market.endTime}
            strikePriceRaw={market.strikePrice}
          />
          <section>
            <h2 className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted">Order book</h2>
            <OrderBookPanel marketId={marketKey} />
          </section>
        </div>
        <div className="lg:sticky lg:top-20">
          <TradeForm marketAddress={marketKey} />
          {/* Hotfix #20 Fix E: resting BUY UP / SELL DOWN orders are hidden by the
              unified orderbook ladder; show them explicitly here with an inline
              Cancel button so the trader can see + manage their own liquidity. */}
          <MyOrdersOnMarket marketComposite={marketKey} />
        </div>
      </div>

      <section>
        <h2 className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted">Your positions</h2>
        {!smartAccount && (
          <EmptyState
            icon="wallet"
            title="Connect wallet to see your positions"
            subtitle="Link your wallet to see holdings for this market."
            className="min-h-0 py-6"
          >
            <WalletConnectorList className="w-full max-w-xs rounded-lg border border-border bg-white p-2" />
          </EmptyState>
        )}
        {smartAccount && localPositions.length === 0 && (
          <EmptyState
            icon="trade"
            title="No position here"
            subtitle="Place a trade using the form above."
            className="min-h-0 py-6"
          />
        )}
        <ul className="mt-2 space-y-2">
          {localPositions.map((p) => (
            <li
              key={`${p.market}-${p.option}`}
              className={cn(
                "panel-dense flex flex-wrap items-center justify-between gap-2",
                p.option === 1 && "border-l-2 border-l-success",
                p.option === 2 && "border-l-2 border-l-down"
              )}
            >
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-xs font-bold",
                  p.option === 1 ? "bg-success-soft text-success-dark" : "bg-down-soft text-down"
                )}
              >
                {p.optionLabel}
              </span>
              <span className="text-xs text-muted">
                Shares <span className="font-mono font-semibold text-foreground">{formatUsdt(p.shares)}</span>
              </span>
              <span className="text-xs text-muted">Avg {p.avgPrice} bps</span>
              <span className="text-[10px] font-medium uppercase text-muted">{p.marketStatus}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

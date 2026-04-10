"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { getMarket, getPositions } from "@/lib/api";
import { formatProbabilityPrice, formatTimeRemainingNoSeconds, formatUsdt } from "@/lib/format";
import { TradingChart } from "@/components/TradingChart";
import { TradeForm } from "@/components/TradeForm";
import { OrderBookPanel } from "@/components/OrderBook";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/cn";

export function MarketPageClient({ address }: { address: string }) {
  const { address: wallet } = useAccount();

  const { data: market, isLoading } = useQuery({
    queryKey: ["market", address.toLowerCase()],
    queryFn: () => getMarket(address),
    refetchInterval: 15_000,
  });

  const { data: positions } = useQuery({
    queryKey: ["positions", wallet?.toLowerCase() ?? ""],
    queryFn: () => getPositions(wallet!),
    enabled: !!wallet,
    refetchInterval: 20_000,
  });

  const localPositions = positions?.filter((p) => p.market.toLowerCase() === address.toLowerCase()) ?? [];

  if (isLoading || !market) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center rounded-xl border border-dashed border-border bg-surface-muted/40 text-sm text-muted">
        Loading market…
      </div>
    );
  }

  const strike =
    market.strikePrice && market.strikePrice !== "0"
      ? formatProbabilityPrice(market.strikePrice)
      : "—";

  return (
    <div className="space-y-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline"
      >
        ← Back to markets
      </Link>
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {(market.pairSymbol ?? market.pairId).replace("-", " / ")}
        </h1>
        <p className="mt-2 font-mono text-xs text-muted sm:text-sm">{market.address}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className={cn(
            "rounded-[6px] px-2.5 py-1 text-xs font-bold uppercase tracking-wide",
            market.status === "ACTIVE"
              ? "bg-success-soft text-success-dark"
              : "bg-[rgba(104,107,130,0.12)] text-neutral-ink"
          )}>
            {market.status}
          </span>
          <span className="text-sm text-muted">
            Strike: <span className="font-semibold text-foreground">{strike}</span>
          </span>
          <span className="text-sm text-muted">
            Time left:{" "}
            <span className="font-semibold text-brand">
              {formatTimeRemainingNoSeconds(market.timeRemainingSeconds)}
            </span>
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <TradingChart symbol={market.chartSymbol === "ETH" ? "ETH" : "BTC"} />
        <TradeForm marketAddress={address} />
      </div>

      <section className="space-y-4">
        <h2 className="font-display border-b border-border pb-2 text-xl font-bold text-foreground">
          Order book
        </h2>
        <OrderBookPanel marketId={address} />
      </section>

      <section className="space-y-4">
        <h2 className="font-display border-b border-border pb-2 text-xl font-bold text-foreground">
          Your positions
        </h2>
        {!wallet && (
          <EmptyState
            icon="wallet"
            title="Connect to view positions"
            subtitle="Link your wallet to see holdings for this market. You can still browse markets and order books without connecting."
          />
        )}
        {wallet && localPositions.length === 0 && (
          <EmptyState
            icon="trade"
            title="No position here"
            subtitle="You do not have an open position in this market yet. Place a trade using the form above."
          />
        )}
        <ul className="space-y-3">
          {localPositions.map((p) => (
            <li
              key={`${p.market}-${p.option}`}
              className={cn(
                "card-kraken flex flex-wrap items-center justify-between gap-3 px-4 py-3",
                p.option === 1 && "border-l-4 border-l-success",
                p.option === 2 && "border-l-4 border-l-down"
              )}
            >
              <span
                className={cn(
                  "rounded-md px-2 py-1 text-sm font-bold",
                  p.option === 1 ? "bg-success-soft text-success-dark" : "bg-down-soft text-down"
                )}
              >
                {p.optionLabel}
              </span>
              <span className="text-sm text-muted">
                Shares <span className="font-mono font-semibold text-foreground">{formatUsdt(p.shares)}</span>
              </span>
              <span className="text-sm text-muted">Avg {p.avgPrice} bps</span>
              <span className="text-xs font-medium uppercase tracking-wide text-muted">{p.marketStatus}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

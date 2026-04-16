"use client";

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { getMarkets, getPriceHistory, type MarketListItem } from "@/lib/api";
import { MarketCard } from "@/components/MarketCard";
import { EmptyState } from "@/components/EmptyState";
import { normalizePriceHistoryData } from "@/lib/priceChart";

const BTC = "BTC-USD" as const;
const TFS = [300, 900, 3600] as const;

function pickPrimaryMarket(list: MarketListItem[] | undefined): MarketListItem | null {
  if (!list?.length) return null;
  const active = list.find((m) => m.status === "ACTIVE");
  return active ?? list[0] ?? null;
}

export default function HomePage() {
  const results = useQueries({
    queries: TFS.map((tf) => ({
      queryKey: ["markets", tf, BTC],
      queryFn: () => getMarkets(tf, BTC),
      refetchInterval: 15_000,
    })),
  });

  const { data: priceRaw, isLoading: priceLoading } = useQuery({
    queryKey: ["priceHistory", "BTC"],
    queryFn: () => getPriceHistory("BTC"),
    refetchInterval: 10_000,
  });

  const btcPoints = useMemo(() => normalizePriceHistoryData(priceRaw), [priceRaw]);
  const spotUsd = useMemo(() => {
    if (btcPoints.length === 0) return null;
    const p = btcPoints[btcPoints.length - 1]!.p;
    return p > 0 ? p : null;
  }, [btcPoints]);

  const markets = useMemo(
    () => TFS.map((_, i) => pickPrimaryMarket(results[i]?.data)),
    [results],
  );

  const loadingMarkets = results.some((r) => r.isLoading);

  if (loadingMarkets || priceLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[280px] animate-pulse rounded-lg border border-border bg-surface-muted/30"
          />
        ))}
      </div>
    );
  }

  if (markets.every((m) => m == null)) {
    return (
      <EmptyState
        icon="chart"
        title="No BTC markets"
        subtitle="No markets returned for 5 min, 15 min, or 1 hour. Check the API or cycler."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {markets.map((m, i) =>
        m ? (
          <MarketCard key={m.address} market={m} btcPoints={btcPoints} spotUsd={spotUsd} />
        ) : (
          <div
            key={`empty-${TFS[i]}`}
            className="panel-dense flex min-h-[200px] items-center justify-center text-center text-xs text-muted"
          >
            No {TFS[i] === 300 ? "5 min" : TFS[i] === 900 ? "15 min" : "1 hour"} market
          </div>
        ),
      )}
    </div>
  );
}

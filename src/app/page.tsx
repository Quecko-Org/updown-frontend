"use client";

import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { useQueries, useQuery } from "@tanstack/react-query";
import { getMarkets, getPriceHistory, type ApiConfig, type MarketListItem } from "@/lib/api";
import { MarketCard } from "@/components/MarketCard";
import { normalizePriceHistoryData, type PricePoint } from "@/lib/priceChart";
import { apiConfigAtom } from "@/store/atoms";

const PAIRS = ["BTC-USD", "ETH-USD"] as const;
const TFS = [300, 900, 3600] as const;

const MAX_CARDS_PER_ROW = 20;

function tfLabel(tf: number) {
  if (tf === 300) return "5 min";
  if (tf === 900) return "15 min";
  return "1 hour";
}

function splitMarkets(list: MarketListItem[] | undefined) {
  if (!list?.length) return { active: null as MarketListItem | null, history: [] as MarketListItem[] };
  const sorted = [...list].sort((a, b) => b.endTime - a.endTime);
  const active = sorted.find((m) => m.status === "ACTIVE") ?? null;
  const history = sorted.filter((m) => m.status !== "ACTIVE");
  return { active, history };
}

type FeeConfig = Pick<ApiConfig, "platformFeeBps" | "makerFeeBps" | "feeModel" | "peakFeeBps"> | null;

function TimeframeRow({
  pair,
  tf,
  active,
  history,
  pricePoints,
  spotUsd,
  feeConfig,
  loading,
}: {
  pair: (typeof PAIRS)[number];
  tf: number;
  active: MarketListItem | null;
  history: MarketListItem[];
  pricePoints: PricePoint[];
  spotUsd: number | null;
  feeConfig: FeeConfig;
  loading: boolean;
}) {
  const pairLabel = pair.replace("-", " / ");
  const label = `${pairLabel} · ${tfLabel(tf)}`;

  if (loading) {
    return (
      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">{label}</h2>
        <div className="h-[200px] animate-pulse rounded-lg border border-border bg-surface-muted/30" />
      </div>
    );
  }

  const cards = [active, ...history].filter(Boolean) as MarketListItem[];
  const visible = cards.slice(0, MAX_CARDS_PER_ROW);

  if (visible.length === 0) {
    return (
      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">{label}</h2>
        <p className="text-xs text-muted">No markets</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">{label}</h2>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {visible.map((m) => (
          <div key={m.address} className="w-[300px] shrink-0">
            <MarketCard market={m} btcPoints={pricePoints} spotUsd={spotUsd} feeConfig={feeConfig} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HomePage() {
  const cfg = useAtomValue(apiConfigAtom);

  const marketQueries = useQueries({
    queries: PAIRS.flatMap((pair) =>
      TFS.map((tf) => ({
        queryKey: ["markets", tf, pair],
        queryFn: () => getMarkets(tf, pair),
        staleTime: 30_000,
        refetchInterval: 60_000,
      })),
    ),
  });

  const { data: btcPriceRaw } = useQuery({
    queryKey: ["priceHistory", "BTC"],
    queryFn: () => getPriceHistory("BTC"),
    refetchInterval: 30_000,
    retry: 2,
    retryDelay: (attempt: number) => Math.min(5000, 1000 * 2 ** attempt),
  });

  const { data: ethPriceRaw } = useQuery({
    queryKey: ["priceHistory", "ETH"],
    queryFn: () => getPriceHistory("ETH"),
    refetchInterval: 30_000,
    retry: 2,
    retryDelay: (attempt: number) => Math.min(5000, 1000 * 2 ** attempt),
  });

  const feeConfig: FeeConfig = cfg
    ? {
        platformFeeBps: cfg.platformFeeBps,
        makerFeeBps: cfg.makerFeeBps,
        feeModel: cfg.feeModel,
        peakFeeBps: cfg.peakFeeBps,
      }
    : null;

  const btcPoints = useMemo(() => normalizePriceHistoryData(btcPriceRaw), [btcPriceRaw]);
  const ethPoints = useMemo(() => normalizePriceHistoryData(ethPriceRaw), [ethPriceRaw]);

  const btcSpot = useMemo(() => {
    if (btcPoints.length === 0) return null;
    const p = btcPoints[btcPoints.length - 1]!.p;
    return p > 0 ? p : null;
  }, [btcPoints]);

  const ethSpot = useMemo(() => {
    if (ethPoints.length === 0) return null;
    const p = ethPoints[ethPoints.length - 1]!.p;
    return p > 0 ? p : null;
  }, [ethPoints]);

  return (
    <div className="space-y-6">
      {PAIRS.map((pair, pi) =>
        TFS.map((tf, ti) => {
          const qIdx = pi * TFS.length + ti;
          const { active, history } = splitMarkets(marketQueries[qIdx]?.data);
          const pricePoints = pair === "BTC-USD" ? btcPoints : ethPoints;
          const spot = pair === "BTC-USD" ? btcSpot : ethSpot;
          const loading = marketQueries[qIdx]?.isPending === true && marketQueries[qIdx]?.data === undefined;

          return (
            <TimeframeRow
              key={`${pair}-${tf}`}
              pair={pair}
              tf={tf}
              active={active}
              history={history}
              pricePoints={pricePoints}
              spotUsd={spot}
              feeConfig={feeConfig}
              loading={loading}
            />
          );
        }),
      )}
    </div>
  );
}

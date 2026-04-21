"use client";

import { useEffect, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMarkets, getPriceHistory, getStats, type ApiConfig, type MarketListItem } from "@/lib/api";
import { MarketCard } from "@/components/MarketCard";
import { normalizePriceHistoryData, type PricePoint } from "@/lib/priceChart";
import { apiConfigAtom } from "@/store/atoms";
import { cn } from "@/lib/cn";
import { formatUsdt } from "@/lib/format";

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

function TimeframeRowWithToggle({
  tf,
  btcData,
  ethData,
  btcPoints,
  ethPoints,
  btcSpot,
  ethSpot,
  feeConfig,
  btcLoading,
  ethLoading,
}: {
  tf: number;
  btcData: { active: MarketListItem | null; history: MarketListItem[] };
  ethData: { active: MarketListItem | null; history: MarketListItem[] };
  btcPoints: PricePoint[];
  ethPoints: PricePoint[];
  btcSpot: number | null;
  ethSpot: number | null;
  feeConfig: FeeConfig;
  btcLoading: boolean;
  ethLoading: boolean;
}) {
  const [selectedPair, setSelectedPair] = useState<"BTC-USD" | "ETH-USD">("BTC-USD");

  const data = selectedPair === "BTC-USD" ? btcData : ethData;
  const pricePoints = selectedPair === "BTC-USD" ? btcPoints : ethPoints;
  const spot = selectedPair === "BTC-USD" ? btcSpot : ethSpot;
  const loading = selectedPair === "BTC-USD" ? btcLoading : ethLoading;
  const pairShort = selectedPair === "BTC-USD" ? "BTC" : "ETH";

  const cards = [data.active, ...data.history].filter(Boolean) as MarketListItem[];
  const visible = cards.slice(0, MAX_CARDS_PER_ROW);

  return (
    <div>
      <div className="pp-mrow__hd">
        <div className="pp-mrow__tflabel">
          <span className="pp-mrow__tf">{tfLabel(tf)}</span>
        </div>
        <div className="pp-mrow__hd-right">
          <div className="pp-tab">
            <button
              type="button"
              className={cn("pp-tab__btn", selectedPair === "BTC-USD" && "pp-tab__btn--on")}
              onClick={() => setSelectedPair("BTC-USD")}
            >
              BTC
            </button>
            <button
              type="button"
              className={cn("pp-tab__btn", selectedPair === "ETH-USD" && "pp-tab__btn--on")}
              onClick={() => setSelectedPair("ETH-USD")}
            >
              ETH
            </button>
          </div>
        </div>
      </div>
      {loading ? (
        <div
          className="h-[180px] rounded-[6px] border"
          style={{ background: "var(--bg-1)", borderColor: "var(--border-0)" }}
        />
      ) : visible.length === 0 ? (
        <p className="pp-caption">
          No {pairShort} markets for {tfLabel(tf)}
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {visible.map((m) => (
            <div key={m.address} className="w-[320px] shrink-0">
              <MarketCard market={m} btcPoints={pricePoints} spotUsd={spot} feeConfig={feeConfig} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  const cfg = useAtomValue(apiConfigAtom);
  const qc = useQueryClient();

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

  const activeEndTimes = useMemo(() => {
    const times: number[] = [];
    for (let i = 0; i < marketQueries.length; i++) {
      const { active } = splitMarkets(marketQueries[i]?.data);
      if (active) times.push(active.endTime);
    }
    return times;
  }, [marketQueries]);

  useEffect(() => {
    if (activeEndTimes.length === 0) return;
    const now = Math.floor(Date.now() / 1000);
    const timers = activeEndTimes
      .map((end) => end - now)
      .filter((left) => left > 0 && left < 7200)
      .map((left) =>
        setTimeout(() => {
          void qc.invalidateQueries({ queryKey: ["markets"] });
        }, (left + 2) * 1000),
      );

    return () => timers.forEach(clearTimeout);
  }, [activeEndTimes, qc]);

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: getStats,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  // Settled-24h: markets from our existing queries that are already RESOLVED
  // or CLAIMED. Backend /stats doesn't expose this count yet, so we derive it
  // client-side from the already-fetched market rows.
  const settledCount = useMemo(() => {
    let n = 0;
    for (const q of marketQueries) {
      for (const m of q.data ?? []) {
        if (m.status === "RESOLVED" || m.status === "CLAIMED") n++;
      }
    }
    return n;
  }, [marketQueries]);

  const volumeLabel = stats ? `$${formatUsdt(stats.totalVolume)}` : "—";
  const openMarkets = stats?.activeMarketsCount ?? null;
  const traders = stats?.totalTraders ?? null;

  return (
    <div className="space-y-8">
      <div className="pp-statsrail">
        <div className="pp-statsrail__cell">
          <span className="pp-micro">24h volume</span>
          <span className="pp-price-xl">{volumeLabel}</span>
        </div>
        <div className="pp-statsrail__cell">
          <span className="pp-micro">Open markets</span>
          <span className="pp-price-xl">{openMarkets != null ? openMarkets : "—"}</span>
        </div>
        <div className="pp-statsrail__cell">
          <span className="pp-micro">Settled 24h</span>
          <span className="pp-price-xl">{settledCount}</span>
        </div>
        <div className="pp-statsrail__cell">
          <span className="pp-micro">Traders 24h</span>
          <span className="pp-price-xl">{traders != null ? traders : "—"}</span>
        </div>
      </div>
      {TFS.map((tf, ti) => (
        <TimeframeRowWithToggle
          key={tf}
          tf={tf}
          btcData={splitMarkets(marketQueries[0 * TFS.length + ti]?.data)}
          ethData={splitMarkets(marketQueries[1 * TFS.length + ti]?.data)}
          btcPoints={btcPoints}
          ethPoints={ethPoints}
          btcSpot={btcSpot}
          ethSpot={ethSpot}
          feeConfig={feeConfig}
          btcLoading={
            marketQueries[0 * TFS.length + ti]?.isPending === true &&
            marketQueries[0 * TFS.length + ti]?.data === undefined
          }
          ethLoading={
            marketQueries[1 * TFS.length + ti]?.isPending === true &&
            marketQueries[1 * TFS.length + ti]?.data === undefined
          }
        />
      ))}
    </div>
  );
}

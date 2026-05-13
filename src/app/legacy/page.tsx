"use client";

/**
 * /legacy — PR-3 hold-bath copy of the pre-cutover homepage.
 *
 * Preserved verbatim from src/app/page.tsx at commit before PR-3 rewrite
 * so the team can compare the two layouts side-by-side during soak.
 * Slated for deletion in PR-4 once the new / has soaked through the
 * audit-prep merge window.
 *
 * Do NOT add features here. Do NOT consume this from elsewhere in the
 * app (no internal links). Bug fixes that surface in soak go to the
 * new / composition, not here.
 */

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

type ResolvedSortKey = "newest" | "volume";

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
  resolvedSort,
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
  resolvedSort: ResolvedSortKey;
}) {
  const [selectedPair, setSelectedPair] = useState<"BTC-USD" | "ETH-USD">("BTC-USD");

  const data = selectedPair === "BTC-USD" ? btcData : ethData;
  const pricePoints = selectedPair === "BTC-USD" ? btcPoints : ethPoints;
  const spot = selectedPair === "BTC-USD" ? btcSpot : ethSpot;
  const loading = selectedPair === "BTC-USD" ? btcLoading : ethLoading;
  const pairShort = selectedPair === "BTC-USD" ? "BTC" : "ETH";

  // Separate active (live trading) from resolved so they render in two
  // visually distinct rows. A single mixed row made it hard to see at a
  // glance which markets were live.
  const active = data.active ? [data.active] : [];
  // Phase2-D: resolved tail sort. `history` arrives endTime-desc from
  // splitMarkets; volume sort is opt-in. BigInt compare avoids the Number
  // overflow when atomic USDT volumes climb past 2**53.
  const resolved = useMemo(() => {
    const list = data.history.slice(0, MAX_CARDS_PER_ROW);
    if (resolvedSort !== "volume") return list;
    return [...list].sort((a, b) => {
      try {
        const av = BigInt(a.volume || "0");
        const bv = BigInt(b.volume || "0");
        return av < bv ? 1 : av > bv ? -1 : 0;
      } catch {
        return 0;
      }
    });
  }, [data.history, resolvedSort]);

  return (
    <div>
      <div className="pp-mrow__hd">
        <div className="pp-mrow__tflabel">
          <span className="pp-mrow__tf">{tfLabel(tf)}</span>
        </div>
        <div className="pp-mrow__hd-right">
          <span className="pp-mrow__count">
            <span className="pp-tabular">{active.length}</span>{" "}
            <span className="pp-caption">open</span>
            <span className="pp-mrow__dot">·</span>
            <span className="pp-tabular">{resolved.length}</span>{" "}
            <span className="pp-caption">resolved</span>
          </span>
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
          className="h-[180px] rounded-[var(--r-lg)] border"
          style={{ background: "var(--bg-1)", borderColor: "var(--border-0)" }}
        />
      ) : active.length === 0 && resolved.length === 0 ? (
        <p className="pp-caption">
          No {pairShort} markets for {tfLabel(tf)}
        </p>
      ) : (
        /* Single horizontal row per timeframe: live markets lead full-size
           on the left, resolved markets trail smaller and dimmed to the
           right in the same flow. Overflow scrolls — no second row below,
           no hairline divider breaking the line up. */
        <div className="flex gap-3 overflow-x-auto pb-2">
          {active.map((m) => (
            <div key={m.address} className="w-[360px] shrink-0">
              <MarketCard market={m} btcPoints={pricePoints} spotUsd={spot} feeConfig={feeConfig} />
            </div>
          ))}
          {resolved.map((m) => (
            <div key={m.address} className="w-[280px] shrink-0" style={{ opacity: 0.72 }}>
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
  // Phase2-D: home-level sort for the resolved-cards tail. Active markets
  // aren't sorted (one per pair × timeframe). Default "newest" preserves
  // the prior endTime-desc behavior so the layout doesn't change for users
  // who don't touch the toggle.
  const [resolvedSort, setResolvedSort] = useState<ResolvedSortKey>("newest");

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

  // Settled-24h: markets RESOLVED/CLAIMED with endTime within the trailing 24h
  // window. Backend /stats doesn't expose a 24h-scoped settled count yet, so
  // we derive it client-side. Bug F: prior version omitted the time filter and
  // showed all-time settled count under a "24h" label — misleading.
  const settledCount = useMemo(() => {
    const cutoffSec = Math.floor(Date.now() / 1000) - 86_400;
    let n = 0;
    for (const q of marketQueries) {
      for (const m of q.data ?? []) {
        if (
          (m.status === "RESOLVED" || m.status === "CLAIMED") &&
          m.endTime >= cutoffSec
        )
          n++;
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
      <div className="flex items-center justify-between gap-2">
        <span className="pp-micro" style={{ color: "var(--fg-2)" }}>
          Resolved tail
        </span>
        <div className="pp-tab" role="tablist" aria-label="Sort resolved markets">
          <button
            type="button"
            className={cn("pp-tab__btn", resolvedSort === "newest" && "pp-tab__btn--on")}
            onClick={() => setResolvedSort("newest")}
            aria-selected={resolvedSort === "newest"}
            role="tab"
          >
            Newest
          </button>
          <button
            type="button"
            className={cn("pp-tab__btn", resolvedSort === "volume" && "pp-tab__btn--on")}
            onClick={() => setResolvedSort("volume")}
            aria-selected={resolvedSort === "volume"}
            role="tab"
          >
            Volume
          </button>
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
          resolvedSort={resolvedSort}
        />
      ))}
    </div>
  );
}

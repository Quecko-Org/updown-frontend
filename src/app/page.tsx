"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMarkets, getStats, type PairSymbol } from "@/lib/api";
import { formatUsdt } from "@/lib/format";
import { MarketCard } from "@/components/MarketCard";
import { EmptyState } from "@/components/EmptyState";

const TIMEFRAMES = [
  { label: "5 min", tf: 300 as const },
  { label: "15 min", tf: 900 as const },
  { label: "1 hour", tf: 3600 as const },
];

const PAIRS: { pair: PairSymbol; label: string; short: string }[] = [
  { pair: "BTC-USD", label: "BTC / USD", short: "BTC" },
  { pair: "ETH-USD", label: "ETH / USD", short: "ETH" },
];

export default function HomePage() {
  const [activeFilter, setActiveFilter] = useState<number | null>(null);
  const sectionRefs = useRef<Record<number, HTMLElement | null>>({});

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: () => getStats(),
    refetchInterval: 20_000,
  });

  const visibleSections = activeFilter
    ? TIMEFRAMES.filter((s) => s.tf === activeFilter)
    : TIMEFRAMES;

  function handleFilterClick(tf: number) {
    if (activeFilter === tf) {
      setActiveFilter(null);
      return;
    }
    setActiveFilter(tf);
    // Scroll to section after a tick so DOM updates
    requestAnimationFrame(() => {
      sectionRefs.current[tf]?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          UpDown Markets
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
          Predict if an asset goes UP or DOWN within a fixed window.
          Connect your wallet, deposit USDT, and start trading.
        </p>
      </div>

      {/* Protocol stats */}
      {stats && (
        <div className="card-kraken flex flex-wrap gap-6 px-5 py-4 sm:gap-8 sm:px-6 sm:py-5">
          <Stat label="Protocol volume" value={`$${formatUsdt(stats.totalVolume)}`} sub="USDT" />
          <div className="hidden h-auto w-px bg-border sm:block" aria-hidden />
          <Stat label="Active markets" value={String(stats.activeMarketsCount)} accent />
          <div className="hidden h-auto w-px bg-border sm:block" aria-hidden />
          <Stat label="Traders" value={String(stats.totalTraders)} />
        </div>
      )}

      {/* Timeframe quick-filter tabs */}
      <div className="flex items-center gap-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted">
          Timeframe
        </span>
        {TIMEFRAMES.map((s) => (
          <button
            key={s.tf}
            type="button"
            onClick={() => handleFilterClick(s.tf)}
            className={
              activeFilter === s.tf
                ? "rounded-[12px] bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors"
                : "rounded-[12px] bg-surface-muted px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-brand-subtle hover:text-brand"
            }
          >
            {s.label}
          </button>
        ))}
        {activeFilter && (
          <button
            type="button"
            onClick={() => setActiveFilter(null)}
            className="ml-1 rounded-[12px] px-3 py-2 text-xs font-medium text-muted transition-colors hover:text-foreground"
          >
            Show all
          </button>
        )}
      </div>

      {/* Market sections */}
      {visibleSections.map((s) => (
        <TimeframeSection
          key={s.tf}
          label={s.label}
          tf={s.tf}
          ref={(el) => { sectionRefs.current[s.tf] = el; }}
        />
      ))}
    </div>
  );
}

/* ── Stat pill ──────────────────────────────────────────────── */

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 font-mono text-xl font-bold tabular-nums sm:text-2xl ${accent ? "text-brand" : "text-foreground"}`}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

/* ── Timeframe section with pair tabs ──────────────────────── */

import { forwardRef } from "react";

const TimeframeSection = forwardRef<HTMLElement, { label: string; tf: 300 | 900 | 3600 }>(
  function TimeframeSection({ label, tf }, ref) {
    const [activePair, setActivePair] = useState<PairSymbol>("BTC-USD");

    return (
      <section ref={ref} className="scroll-mt-24">
        {/* Section header with pair tabs inline */}
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {label}
          </h2>
          <div className="flex gap-1">
            {PAIRS.map((p) => (
              <button
                key={p.pair}
                type="button"
                onClick={() => setActivePair(p.pair)}
                className={
                  activePair === p.pair
                    ? "rounded-[12px] bg-brand-subtle px-3.5 py-1.5 text-sm font-bold text-brand transition-colors"
                    : "rounded-[12px] px-3.5 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
                }
              >
                {p.short}
              </button>
            ))}
          </div>
        </div>

        <MarketGrid timeframe={tf} pair={activePair} />
      </section>
    );
  }
);

/* ── Market grid ───────────────────────────────────────────── */

function MarketGrid({ timeframe, pair }: { timeframe: 300 | 900 | 3600; pair: PairSymbol }) {
  const { data, isLoading } = useQuery({
    queryKey: ["markets", timeframe, pair],
    queryFn: () => getMarkets(timeframe, pair),
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return (
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[180px] animate-pulse rounded-xl border border-border bg-surface-muted/40"
          />
        ))}
      </div>
    );
  }

  if (!data?.length) {
    return (
      <EmptyState
        icon="chart"
        title={`No ${pair.replace("-", "/")} markets`}
        subtitle={`Waiting for the auto-cycler to create ${pair.replace("-", "/")} pools for this timeframe.`}
      />
    );
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((m) => (
        <MarketCard key={m.address} market={m} />
      ))}
    </div>
  );
}

"use client";

/**
 * /  (homepage) — PR-3 single-page chart-anchored markets composition.
 *
 * Replaces the old MarketCard grid. Layout (top to bottom):
 *   1. Asset picker + Timeframe segmented control
 *   2. Chart (per-market Chainlink history with one-shot Coinbase backfill,
 *      sourced from the LIVE market for the selected pair+timeframe)
 *   3. Live / Resolved toggle + section label
 *   4. LiveMarketRow → OpenMarketRow → three NextMarketRows
 *
 * State ladder (handled in this file, not in child components):
 *   - loading + no data    → row-slot skeletons keep the layout stable
 *   - error                → state card with retry, rows stay hidden
 *   - empty market list    → "no live markets for X right now" card with
 *                            a switch-timeframe nudge
 *   - live missing, open present → headline note above the open row
 *   - happy path           → live + open + nextThree rendered in sequence
 *
 * Old composition is preserved at /legacy during the PR-3 → PR-4 soak.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getMarkets, getPriceHistory, type MarketListItem } from "@/lib/api";
import { computeImpliedProb } from "@/lib/format";
import { normalizePriceHistoryData } from "@/lib/priceChart";
import { LiveMarketRow } from "@/components/markets/LiveMarketRow";
import { OpenMarketRow } from "@/components/markets/OpenMarketRow";
import { NextMarketRow } from "@/components/markets/NextMarketRow";
import { MarketsPageChart } from "@/components/markets/MarketsPageChart";
import { AssetPicker, type Asset } from "@/components/markets/AssetPicker";
import { TimeframeSegmented, type Timeframe } from "@/components/markets/TimeframeSegmented";
import { LiveResolvedToggle, type RowsMode } from "@/components/markets/LiveResolvedToggle";
import { TradeDrawer, type TradeSide } from "@/components/markets/TradeDrawer";
import { useTrackLastMarketView } from "@/hooks/useLastMarketView";

const TF_TO_SEC: Record<Timeframe, 300 | 900 | 3600> = {
  "5m": 300,
  "15m": 900,
  "60m": 3600,
};

const ASSET_TO_PAIR: Record<Asset, "BTC-USD" | "ETH-USD"> = {
  btc: "BTC-USD",
  eth: "ETH-USD",
};

function clampAsset(raw: string | null): Asset {
  return raw === "eth" ? "eth" : "btc";
}

function clampTimeframe(raw: string | null): Timeframe {
  if (raw === "15m" || raw === "60m") return raw;
  return "5m";
}

type Buckets = {
  live: MarketListItem | null;
  open: MarketListItem | null;
  next: MarketListItem[];
  resolved: MarketListItem[];
};

function bucketMarkets(list: MarketListItem[] | undefined, nowSec: number): Buckets {
  if (!list?.length) return { live: null, open: null, next: [], resolved: [] };
  const sorted = [...list].sort((a, b) => a.startTime - b.startTime);
  const live = sorted.find((m) => m.status === "ACTIVE") ?? null;
  const upcoming = sorted.filter((m) => m.startTime > nowSec && m.status !== "ACTIVE");
  const open = upcoming[0] ?? null;
  const next = upcoming.slice(1, 4);
  const resolved = sorted
    .filter((m) => m.status !== "ACTIVE" && m.endTime <= nowSec)
    .sort((a, b) => b.endTime - a.endTime)
    .slice(0, 12);
  return { live, open, next, resolved };
}

function MarketsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const asset = clampAsset(searchParams.get("asset"));
  const timeframe = clampTimeframe(searchParams.get("timeframe"));
  const [rowsMode, setRowsMode] = useState<RowsMode>("live");
  const [drawer, setDrawer] = useState<{ side: TradeSide; market: MarketListItem } | null>(null);

  // Stash {asset, timeframe} for the header logo / back-button restoration.
  useTrackLastMarketView();

  // 1s ticker for the countdown computations below; cheap and keeps the
  // Live row's timer + Next rows' "opens in" labels accurate without
  // each row mounting its own interval.
  const [nowSec, setNowSec] = useState<number>(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["markets", ASSET_TO_PAIR[asset], TF_TO_SEC[timeframe]],
    queryFn: () => getMarkets(TF_TO_SEC[timeframe], ASSET_TO_PAIR[asset]),
    refetchInterval: 15_000,
  });

  // Spot price for the active asset, threaded into the asset pill.
  const { data: btcSpot } = useQuery({
    queryKey: ["spot", "BTC"],
    queryFn: async () => {
      const ph = await getPriceHistory("BTC");
      const points = normalizePriceHistoryData(ph);
      return points.length ? points[points.length - 1].p : null;
    },
    refetchInterval: 30_000,
  });
  const { data: ethSpot } = useQuery({
    queryKey: ["spot", "ETH"],
    queryFn: async () => {
      const ph = await getPriceHistory("ETH");
      const points = normalizePriceHistoryData(ph);
      return points.length ? points[points.length - 1].p : null;
    },
    refetchInterval: 30_000,
  });

  const buckets = useMemo(() => bucketMarkets(data, nowSec), [data, nowSec]);

  const setQueryParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(key, value);
      router.replace(`/?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const handleAssetChange = (next: Asset) => setQueryParam("asset", next);
  const handleTimeframeChange = (next: Timeframe) => setQueryParam("timeframe", next);

  const handleSelectSide = (side: "up" | "down") => {
    if (!buckets.open) return;
    setDrawer({ side, market: buckets.open });
  };

  const handleDrawerSubmit = ({ side, stakeUsd }: { side: TradeSide; stakeUsd: number }) => {
    // PR-3 leaves trade submission as a follow-up. Log the intent so the
    // UI flow is exercised end-to-end during the visual sweep + so the
    // path is obvious for PR-4's wiring.
    // eslint-disable-next-line no-console
    console.info("[trade-drawer] submit", { side, stakeUsd, market: drawer?.market?.address });
    setDrawer(null);
  };

  return (
    <main className="pp-markets-page">
      <div className="pp-markets-page__controls">
        <AssetPicker
          selected={asset}
          btcSpotUsd={btcSpot ?? null}
          ethSpotUsd={ethSpot ?? null}
          onChange={handleAssetChange}
        />
        <TimeframeSegmented selected={timeframe} onChange={handleTimeframeChange} />
      </div>

      {/* Chart anchor: live market when present, otherwise fall back to the
          most-recently-resolved market for this pair+timeframe so the chart
          stays populated through cycler pauses. PR-3 left this as a blank
          fallback ("chart will populate when next market opens"); PR-4
          rewires it to read the resolved history. */}
      <MarketsPageChart
        asset={asset}
        timeframe={timeframe}
        liveMarket={buckets.live ?? buckets.resolved[0] ?? null}
      />

      <div className="pp-markets-page__rows-header">
        <h2 className="pp-section-label">
          {asset.toUpperCase()} · {timeframe.toUpperCase()}
        </h2>
        <LiveResolvedToggle value={rowsMode} onChange={setRowsMode} />
      </div>

      {isError ? (
        <div className="pp-state-card" data-testid="state-error">
          <h3 className="pp-state-card__title">Couldn&apos;t load markets</h3>
          <p className="pp-state-card__body">
            The backend didn&apos;t answer in time. Try again — if it keeps failing,
            the dev API may be paused.
          </p>
          <div className="pp-state-card__actions">
            <button type="button" className="pp-btn pp-btn--secondary" onClick={() => refetch()}>
              Retry
            </button>
          </div>
        </div>
      ) : isLoading && !data ? (
        <div data-testid="state-loading">
          <div className="pp-row-skeleton" />
          <div className="pp-row-skeleton" style={{ marginTop: 16 }} />
          <div className="pp-row-skeleton" style={{ marginTop: 8 }} />
          <div className="pp-row-skeleton" style={{ marginTop: 8 }} />
          <div className="pp-row-skeleton" style={{ marginTop: 8 }} />
        </div>
      ) : rowsMode === "live" ? (
        renderLiveBranch(buckets, nowSec, handleSelectSide, asset, timeframe, handleTimeframeChange)
      ) : (
        renderResolvedBranch(buckets)
      )}

      {drawer && (
        <TradeDrawer
          market={drawer.market}
          initialSide={drawer.side}
          asset={asset}
          onClose={() => setDrawer(null)}
          onSubmit={handleDrawerSubmit}
        />
      )}
    </main>
  );
}

function renderLiveBranch(
  buckets: Buckets,
  nowSec: number,
  onSelectSide: (side: "up" | "down") => void,
  asset: Asset,
  timeframe: Timeframe,
  onTimeframeChange: (t: Timeframe) => void,
) {
  const { live, open, next } = buckets;
  const hasAnything = live || open || next.length > 0;

  if (!hasAnything) {
    const otherTf: Timeframe = timeframe === "5m" ? "15m" : "5m";
    const fallback = buckets.resolved[0];
    return (
      <div className="pp-state-card" data-testid="state-empty">
        <h3 className="pp-state-card__title">
          No live markets for {asset.toUpperCase()} {timeframe.toUpperCase()}
        </h3>
        {fallback ? (
          <p className="pp-state-card__body">
            Showing the most recent resolved market above —{" "}
            <span className="pp-state-card__countdown">
              {new Date(fallback.endTime * 1000).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {fallback.winner != null && (
              <>
                , {fallback.winner === 1 ? "UP" : fallback.winner === 2 ? "DOWN" : "no winner"} won
              </>
            )}
            . The cycler hasn&apos;t opened a window for this pair + timeframe right now.
          </p>
        ) : (
          <p className="pp-state-card__body">
            The cycler hasn&apos;t opened a window for this pair + timeframe right now.
            Try a different timeframe or check back in a minute.
          </p>
        )}
        <div className="pp-state-card__actions">
          <button type="button" className="pp-btn pp-btn--secondary" onClick={() => onTimeframeChange(otherTf)}>
            Try {otherTf}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {live ? (
        (() => {
          const prob = computeImpliedProb(live.upPrice, live.downPrice);
          return (
            <LiveMarketRow
              market={live}
              countdownSeconds={Math.max(0, live.endTime - nowSec)}
              upTraderCount={0}
              downTraderCount={0}
              upPct={prob?.upPct ?? null}
              downPct={prob?.downPct ?? null}
            />
          );
        })()
      ) : (
        <div className="pp-state-card" data-testid="state-no-live">
          <p className="pp-state-card__body">
            No live market right now. The next window opens at{" "}
            <span className="pp-state-card__countdown">
              {open
                ? new Date(open.startTime * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                : "—"}
            </span>
            .
          </p>
        </div>
      )}

      {open &&
        (() => {
          const prob = computeImpliedProb(open.upPrice, open.downPrice);
          // share prices fall back to 50/50 until the orderbook
          // subscription lands (PR-5) and gives us real mid quotes.
          const upCents = prob?.upPct ?? 50;
          const downCents = prob?.downPct ?? 50;
          return (
            <OpenMarketRow
              market={open}
              upSharePriceCents={upCents}
              downSharePriceCents={downCents}
              upPct={prob?.upPct ?? null}
              downPct={prob?.downPct ?? null}
              poolUsdt={Number(open.volume || "0")}
              traderCount={0}
              countdownSecondsUntilClose={Math.max(0, open.endTime - nowSec)}
              onSelectSide={onSelectSide}
            />
          );
        })()}

      {next.slice(0, 3).map((m, i) => (
        <NextMarketRow
          key={m.address}
          market={m}
          upSharePriceCents={50}
          downSharePriceCents={50}
          secondsUntilOpen={Math.max(0, m.startTime - nowSec)}
          depth={i as 0 | 1 | 2}
        />
      ))}
    </>
  );
}

function renderResolvedBranch(buckets: Buckets) {
  if (buckets.resolved.length === 0) {
    return (
      <div className="pp-state-card" data-testid="state-empty-resolved">
        <h3 className="pp-state-card__title">No recently resolved markets</h3>
        <p className="pp-state-card__body">
          Resolutions land here as soon as the cycler closes a window. Check back after
          the current live market settles.
        </p>
      </div>
    );
  }
  return (
    <>
      {buckets.resolved.map((m) => {
        const prob = computeImpliedProb(m.upPrice, m.downPrice);
        return (
          <LiveMarketRow
            key={m.address}
            market={m}
            countdownSeconds={0}
            upTraderCount={0}
            downTraderCount={0}
            upPct={prob?.upPct ?? null}
            downPct={prob?.downPct ?? null}
          />
        );
      })}
    </>
  );
}

export default function MarketsHomePage() {
  return (
    <Suspense
      fallback={
        <main className="pp-markets-page">
          <div className="pp-row-skeleton" style={{ height: 280 }} />
        </main>
      }
    >
      <MarketsPageInner />
    </Suspense>
  );
}

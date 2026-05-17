"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMarketPrices } from "@/lib/api";
import { formatStrikeUsd, parseStrikeUsdNumber } from "@/lib/format";
import { clipPointsBetween, normalizePriceHistoryData, type PricePoint } from "@/lib/priceChart";
import { cn } from "@/lib/cn";

/**
 * Phase2-G: Y-axis zoom mode.
 *  - "strike"   = strike-fit. Range includes strike + spot + series so the
 *                 user always sees how spot compares to strike. Default.
 *  - "spot"     = spot-fit. Range hugs the actual price ticks (+ small pad).
 *                 Useful late in a market when spot has drifted far from
 *                 strike and the strike-fit view squashes the line into a
 *                 thin band at the top/bottom of the frame. Strike line +
 *                 badge are hidden when strike falls outside the visible
 *                 range in this mode (clamping would mislead the eye into
 *                 thinking the price was crossing strike).
 */
type YScaleMode = "strike" | "spot";

const VB_W = 820;
const VB_H = 280;
const PAD_L = 12;
const PAD_R = 72;
const PAD_T = 16;
const PAD_B = 28;
const CHART_W = VB_W - PAD_L - PAD_R;
const CHART_H = VB_H - PAD_T - PAD_B;

const Y_TICKS = 5;
const X_TICKS = 6;

const ENDPOINT_EASE_MS = 900;

function fmtUsd(v: number): string {
  if (v >= 1000) return `$${Math.round(v).toLocaleString("en-US")}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

function fmtPrice2(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTick(secEpoch: number, windowSec: number): string {
  const d = new Date(secEpoch * 1000);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  if (windowSec <= 300) {
    const ss = d.getSeconds().toString().padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }
  return `${hh}:${mm}`;
}

/**
 * Stable Y-range hook — re-uses prior extrema unless a tick clearly escapes
 * them. Keeps the 5 gridlines steady instead of twitching on every WS push.
 *
 * 2026-05-03: also resets when the new target range is dramatically narrower
 * than the cached one (>10x). Pre-fix the hook only ever EXPANDED — so a
 * transient first-render state (rangeSeries empty, currentSpot null,
 * fallback to 0) could pin pMin=0 and freeze a $0–$2600 axis even after
 * real ticks arrived in the $2322 band, making $4 of price variance
 * invisible at the resolution of $720 per gridline.
 */
function useStableYRange(seriesKey: string, rawMin: number, rawMax: number) {
  const stateRef = useRef<{ key: string; min: number; max: number } | null>(null);
  const pad = Math.max((rawMax - rawMin) * 0.12, rawMax * 0.0005, 1);
  const target = { min: rawMin - pad, max: rawMax + pad };

  const prev = stateRef.current;
  if (!prev || prev.key !== seriesKey) {
    stateRef.current = { key: seriesKey, ...target };
    return target;
  }

  const prevRange = prev.max - prev.min;
  const targetRange = target.max - target.min;
  // Snap to the new range if it's >10x tighter — "we were stuck on a
  // bogus wide range" guard. Otherwise keep stability semantics.
  if (prevRange > targetRange * 10) {
    stateRef.current = { key: seriesKey, ...target };
    return target;
  }

  const buffer = prevRange * 0.02;
  let { min, max } = prev;
  if (target.min < prev.min - buffer) min = target.min;
  if (target.max > prev.max + buffer) max = target.max;
  if (min !== prev.min || max !== prev.max) {
    stateRef.current = { key: seriesKey, min, max };
    return { min, max };
  }
  return { min: prev.min, max: prev.max };
}

export function MarketPriceChart({
  symbol,
  marketAddress,
  marketStartSec,
  marketEndSec,
  strikePriceRaw,
  strikeDecimals,
  settlementPriceRaw,
  isResolved = false,
}: {
  /** Display only — chart series is now keyed by marketAddress. */
  symbol: "BTC" | "ETH";
  /** PR-20 Phase 2: chart now reads per-market Chainlink history (with one-shot
   *  Coinbase backfill) instead of the symbol-wide spot feed. */
  marketAddress: string;
  marketStartSec: number;
  marketEndSec: number;
  strikePriceRaw?: string;
  /** Streams-strike Path B (2026-05-16): atomic scale for strike/settlement
   *  raw values. Defaults inside the formatter when omitted. */
  strikeDecimals?: number;
  settlementPriceRaw?: string;
  isResolved?: boolean;
}) {
  // PR-20 Phase 2: keyed by marketAddress so the WS handler in
  // useUpDownWebSocket can append `market_price_snapshot` ticks via
  // setQueryData(["marketPrices", address], ...) without needing the
  // chart component mounted. The 10s polling interval is gone — fresh
  // data arrives on the WS stream.
  const addrLower = marketAddress.toLowerCase();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["marketPrices", addrLower],
    queryFn: () => getMarketPrices(marketAddress, marketStartSec, marketEndSec),
    // Resolved markets are immutable — never refetch. Active markets
    // get their tail from WS pushes, so a polling fallback is just a
    // safety net for missed frames; keep one slow refetch.
    refetchInterval: isResolved ? false : 30_000,
    staleTime: isResolved ? Infinity : 0,
  });

  const strikeNum = parseStrikeUsdNumber(strikePriceRaw, strikeDecimals);
  const settlementNum = parseStrikeUsdNumber(settlementPriceRaw, strikeDecimals);
  const strikeLabel = formatStrikeUsd(strikePriceRaw, strikeDecimals);
  const [yScaleMode, setYScaleMode] = useState<YScaleMode>("strike");

  const allPoints = useMemo(() => normalizePriceHistoryData(data), [data]);

  // Raw clipped series inside the market window.
  const rawSeries = useMemo(
    () => clipPointsBetween(allPoints, marketStartSec, marketEndSec),
    [allPoints, marketStartSec, marketEndSec],
  );

  // PR-20 Phase 2: the synthetic strike-anchor at marketStartSec is gone.
  // The chart now consumes per-market Chainlink snapshots (with one-shot
  // Coinbase backfill) instead of the symbol-wide spot feed, so the very
  // first real tick lands on (or within Chainlink heartbeat-distance of)
  // the strike — matching strike via real data, not by synthesizing a
  // point on top of the strike line.
  //
  // Resolved markets still pin the last point to settlementPrice at
  // marketEndSec so the chart visibly closes on where the market landed.
  const series = useMemo((): PricePoint[] => {
    const s: PricePoint[] = [...rawSeries];
    if (isResolved && settlementNum != null) {
      const lastT = s[s.length - 1]?.t ?? marketStartSec;
      if (lastT < marketEndSec) {
        s.push({ t: marketEndSec, p: settlementNum });
      } else if (s.length > 0) {
        s[s.length - 1] = { t: marketEndSec, p: settlementNum };
      }
    }
    return s;
  }, [rawSeries, settlementNum, isResolved, marketStartSec, marketEndSec]);

  // Sub-second "tickNow" for smooth endpoint glide between WS ticks.
  const [tickNow, setTickNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (isResolved) return;
    const id = setInterval(() => setTickNow(Date.now() / 1000), 250);
    return () => clearInterval(id);
  }, [isResolved]);

  const windowSec = Math.max(60, marketEndSec - marketStartSec);

  // Current spot — last real (non-synthetic) point in the market window.
  // For resolved markets, spot = settlement.
  const currentSpot = useMemo(() => {
    if (isResolved && settlementNum != null) return settlementNum;
    if (rawSeries.length) return rawSeries[rawSeries.length - 1]!.p;
    if (allPoints.length) return allPoints[allPoints.length - 1]!.p;
    return null;
  }, [rawSeries, allPoints, isResolved, settlementNum]);

  // Y range. Strike-fit (default) extends the visible band to also cover the
  // strike level so the strike line + price ticks are both in frame at once.
  // Spot-fit drops the strike consideration: extrema come from `rawSeries`
  // (real ticks only) + currentSpot, so the chart hugs the actual price
  // envelope when strike has drifted far away.
  //
  // PR-20 Phase 2: with the synthetic strike-anchor gone, `series === rawSeries`
  // for live markets — `rangeSeries = series` works for either mode. We keep
  // the explicit branch to make the strike-vs-spot intent obvious and to
  // future-proof against re-introducing synthetic anchors elsewhere.
  const includeStrike = yScaleMode === "strike";
  const rangeSeries = includeStrike ? series : rawSeries;
  // 2026-05-03: fallback chain when rangeSeries is empty (first render before
  // data lands) — `currentSpot ?? strikeNum ?? 0`. Pre-fix the `?? 0` got
  // baked into useStableYRange's persistent state, pinning pMin=0 forever.
  // strikeNum is parsed from market metadata and present for any market the
  // chart could possibly render, so it's a much safer default.
  const fallbackPrice = currentSpot ?? strikeNum ?? 0;
  const priceMin = rangeSeries.length ? Math.min(...rangeSeries.map((p) => p.p)) : fallbackPrice;
  const priceMax = rangeSeries.length ? Math.max(...rangeSeries.map((p) => p.p)) : fallbackPrice;
  const ymin = Math.min(
    priceMin,
    includeStrike ? (strikeNum ?? priceMin) : priceMin,
    currentSpot ?? priceMin,
  );
  const ymax = Math.max(
    priceMax,
    includeStrike ? (strikeNum ?? priceMax) : priceMax,
    currentSpot ?? priceMax,
  );
  // Re-key on yScaleMode so useStableYRange resets to the new extrema instead
  // of carrying the wider strike-fit range into spot-fit (otherwise the toggle
  // would be a no-op until the next out-of-range tick).
  const seriesKey = `${symbol}:${marketStartSec}:${marketEndSec}:${isResolved ? "R" : "A"}:${yScaleMode}`;
  const yRange = useStableYRange(seriesKey, ymin, ymax);

  const geom = useMemo(() => {
    if (series.length < 2) return null;

    const t0 = marketStartSec;
    const t1 = marketEndSec;
    const dt = t1 - t0 || 1;

    const pMin = yRange.min;
    const pMax = yRange.max;
    const dp = pMax - pMin || 1;

    const tx = (t: number) =>
      PAD_L + (Math.max(t0, Math.min(t1, t)) - t0) / dt * CHART_W;
    const py = (p: number) => PAD_T + CHART_H - ((p - pMin) / dp) * CHART_H;

    // 2026-05-04: step-after interpolation. Price was P[i-1] from t[i-1]
    // until t[i], at which point it stepped to P[i]. Each segment becomes
    // two SVG commands: a horizontal line holding the prior y until the
    // new x, then a vertical line stepping to the new y. Pre-fix the
    // raw `M ... L ... L ...` was linear interpolation between samples,
    // which visually invented gradual transitions that didn't actually
    // happen — Coinbase ticker fires per-match and the price held flat
    // between matches. Step-after matches reality.
    const lineD = series
      .map((pt, i) => {
        const x = tx(pt.t).toFixed(1);
        const y = py(pt.p).toFixed(1);
        if (i === 0) return `M${x},${y}`;
        const prev = series[i - 1]!;
        const prevY = py(prev.p).toFixed(1);
        // Horizontal at prior y to new x, then vertical to new y.
        return `L${x},${prevY} L${x},${y}`;
      })
      .join(" ");

    const xFirst = tx(series[0]!.t);
    const xLast = tx(series[series.length - 1]!.t);
    const baseY = PAD_T + CHART_H;
    const areaD = `${lineD} L${xLast.toFixed(1)},${baseY.toFixed(1)} L${xFirst.toFixed(1)},${baseY.toFixed(1)} Z`;

    // In spot-fit mode the strike may sit outside the visible Y range. Hide
    // the line + badge entirely in that case rather than clamping to a frame
    // edge — clamping would suggest the price line was crossing strike when
    // it isn't.
    const strikeVisible =
      strikeNum != null &&
      (yScaleMode === "strike" ||
        (strikeNum >= pMin && strikeNum <= pMax));
    const strikeY = strikeVisible && strikeNum != null ? py(strikeNum) : null;
    const currentY = currentSpot != null ? py(currentSpot) : null;
    const last = series[series.length - 1]!;
    const above = strikeNum == null ? true : last.p >= strikeNum;

    // Endpoint X glides with tickNow for live markets; resolved markets pin
    // the marker to settlement time.
    const endX = isResolved ? tx(t1) : tx(Math.max(last.t, Math.min(tickNow, t1)));
    const endY = py(last.p);

    const yLabels = Array.from({ length: Y_TICKS }, (_, i) => {
      const u = i / (Y_TICKS - 1);
      const v = pMax - u * dp;
      return { y: PAD_T + u * CHART_H, v };
    });

    const xLabels = Array.from({ length: X_TICKS }, (_, i) => {
      const u = i / (X_TICKS - 1);
      const sec = t0 + u * dt;
      return { x: PAD_L + u * CHART_W, label: fmtTick(sec, windowSec) };
    });

    return { lineD, areaD, strikeY, currentY, above, endX, endY, yLabels, xLabels };
  }, [series, marketStartSec, marketEndSec, strikeNum, currentSpot, tickNow, isResolved, windowSec, yRange.min, yRange.max, yScaleMode]);

  const directionColor = geom?.above ? "var(--up)" : "var(--down)";
  const directionLabel = strikeNum == null || !geom ? "—" : geom.above ? "UP ▲" : "DOWN ▼";
  const gradId = `pp-chart-grad-${symbol}-${isResolved ? "r" : "a"}`;

  // "Now" line color — cyan/neutral so it reads as distinct from the white
  // strike and the green/red directional accents.
  const nowColor = "oklch(78% 0.12 220)";

  return (
    <div
      className="flex flex-col overflow-hidden rounded-[var(--r-lg)] border"
      style={{ background: "var(--bg-1)", borderColor: "var(--border-0)" }}
    >
      <div
        className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-3 py-2"
        style={{ borderColor: "var(--border-0)" }}
      >
        <div className="flex items-baseline gap-2">
          <span className="pp-micro">Strike</span>
          <span className="pp-price-md">{strikeLabel}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="pp-micro">{isResolved ? "Settlement" : "Current"}</span>
          <span
            className="pp-price-md"
            style={{ color: isResolved ? directionColor : nowColor }}
          >
            {currentSpot != null ? fmtPrice2(currentSpot) : "—"}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div
            className="pp-tab"
            role="tablist"
            aria-label="Y-axis zoom"
            title="Strike-fit keeps the strike line in view; Spot-fit zooms in on price ticks."
          >
            <button
              type="button"
              className={cn("pp-tab__btn", yScaleMode === "strike" && "pp-tab__btn--on")}
              onClick={() => setYScaleMode("strike")}
              aria-selected={yScaleMode === "strike"}
              role="tab"
            >
              Strike-fit
            </button>
            <button
              type="button"
              className={cn("pp-tab__btn", yScaleMode === "spot" && "pp-tab__btn--on")}
              onClick={() => setYScaleMode("spot")}
              aria-selected={yScaleMode === "spot"}
              role="tab"
            >
              Spot-fit
            </button>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="pp-micro">Direction</span>
            <span
              className="pp-price-md"
              style={{ color: strikeNum == null || !geom ? "var(--fg-2)" : directionColor }}
            >
              {directionLabel}
            </span>
          </div>
        </div>
      </div>
      <div className="relative aspect-[820/280] min-h-[220px] w-full flex-1 sm:min-h-[280px]">
        {isLoading && <p className="p-4 pp-caption">Loading chart…</p>}
        {isError && !isLoading && (
          <p className="p-4 pp-body-strong">Price data unavailable</p>
        )}
        {!isLoading && !isError && (!geom || series.length < 2) && (
          <p className="p-4 pp-caption">Not enough price data in this market window.</p>
        )}
        {!isLoading && !isError && geom && series.length >= 2 && (
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            className="block h-full w-full"
            preserveAspectRatio="none"
            role="img"
          >
            <defs>
              <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={geom.above ? "oklch(74% 0.18 155)" : "oklch(68% 0.22 25)"}
                  stopOpacity="0.22"
                />
                <stop
                  offset="100%"
                  stopColor={geom.above ? "oklch(74% 0.18 155)" : "oklch(68% 0.22 25)"}
                  stopOpacity="0"
                />
              </linearGradient>
            </defs>

            {/* Y gridlines + right-gutter price labels */}
            {geom.yLabels.map((t, i) => (
              <g key={`y-${i}`}>
                <line
                  x1={PAD_L}
                  x2={VB_W - PAD_R}
                  y1={t.y}
                  y2={t.y}
                  stroke="var(--border-0)"
                  strokeWidth="1"
                  shapeRendering="crispEdges"
                  opacity="0.6"
                />
                <text
                  x={VB_W - PAD_R + 6}
                  y={t.y + 3}
                  fontFamily="Geist Mono, ui-monospace, monospace"
                  fontSize="10"
                  fill="var(--fg-2)"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {fmtUsd(t.v)}
                </text>
              </g>
            ))}

            {/* Strike line + labeled badge */}
            {geom.strikeY != null && (
              <>
                <line
                  x1={PAD_L}
                  x2={VB_W - PAD_R}
                  y1={geom.strikeY}
                  y2={geom.strikeY}
                  stroke="var(--fg-1)"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                  opacity="0.9"
                />
                <rect
                  x={VB_W - PAD_R - 58}
                  y={geom.strikeY - 9}
                  width="54"
                  height="16"
                  fill="var(--bg-0)"
                  stroke="var(--border-1)"
                  strokeWidth="1"
                  rx="2"
                />
                <text
                  x={VB_W - PAD_R - 31}
                  y={geom.strikeY + 2}
                  textAnchor="middle"
                  fontFamily="Geist Mono, ui-monospace, monospace"
                  fontSize="10"
                  fill="var(--fg-0)"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  STRIKE
                </text>
              </>
            )}

            {/* Current-price line + badge — distinct cyan, separate from strike.
                Hidden in resolved mode since the price IS the settlement and
                already tracked by the endpoint dot. */}
            {!isResolved && geom.currentY != null && currentSpot != null && (
              <>
                <line
                  x1={PAD_L}
                  x2={VB_W - PAD_R}
                  y1={geom.currentY}
                  y2={geom.currentY}
                  stroke={nowColor}
                  strokeWidth="1"
                  strokeDasharray="2 3"
                  opacity="0.85"
                />
                <rect
                  x={VB_W - PAD_R - 58}
                  y={geom.currentY - 9}
                  width="54"
                  height="16"
                  fill="var(--bg-0)"
                  stroke={nowColor}
                  strokeWidth="1"
                  rx="2"
                />
                <text
                  x={VB_W - PAD_R - 31}
                  y={geom.currentY + 2}
                  textAnchor="middle"
                  fontFamily="Geist Mono, ui-monospace, monospace"
                  fontSize="10"
                  fill={nowColor}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  NOW
                </text>
              </>
            )}

            <path d={geom.areaD} fill={`url(#${gradId})`} />
            <path
              d={geom.lineD}
              fill="none"
              stroke={directionColor}
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />

            <g
              style={{
                transform: `translate(${geom.endX}px, ${geom.endY}px)`,
                transition: `transform ${ENDPOINT_EASE_MS}ms cubic-bezier(0.2, 0, 0, 1)`,
              }}
            >
              <circle r="6" fill={directionColor} opacity="0.22" />
              <circle r="3" fill={directionColor} />
            </g>

            <line
              x1={PAD_L}
              x2={VB_W - PAD_R}
              y1={VB_H - PAD_B}
              y2={VB_H - PAD_B}
              stroke="var(--border-0)"
              strokeWidth="1"
            />

            {geom.xLabels.map((t, i) => (
              <text
                key={`x-${i}`}
                x={t.x}
                y={VB_H - PAD_B + 16}
                textAnchor={
                  i === 0 ? "start" : i === geom.xLabels.length - 1 ? "end" : "middle"
                }
                fontFamily="Geist Mono, ui-monospace, monospace"
                fontSize="10"
                fill="var(--fg-2)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {t.label}
              </text>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPriceHistory } from "@/lib/api";
import { formatStrikeUsd, parseStrikeUsdNumber } from "@/lib/format";
import { clipPointsBetween, normalizePriceHistoryData, type PricePoint } from "@/lib/priceChart";

// Viewbox chosen to match pp-chart dimensions from the handoff spec.
const VB_W = 820;
const VB_H = 280;
const PAD_L = 12;
const PAD_R = 64;   // right gutter hosts the Y-axis price labels
const PAD_T = 16;
const PAD_B = 28;
const CHART_W = VB_W - PAD_L - PAD_R;
const CHART_H = VB_H - PAD_T - PAD_B;

const Y_TICKS = 5;
const X_TICKS = 6;

// Smooth endpoint motion between WS ticks (~1s cadence). 900ms CSS ease on
// the dot's transform keeps it gliding toward the next point rather than
// snapping, which reads as "continuous" even though the data is discrete.
const ENDPOINT_EASE_MS = 900;

function buildSeries(all: PricePoint[], startSec: number, endSec: number): PricePoint[] {
  const s = clipPointsBetween(all, startSec, endSec);
  if (s.length >= 2) return s;
  const beforeEnd = all.filter((p) => p.t <= endSec);
  const tail = beforeEnd.slice(-120);
  return tail.length >= 2 ? tail : beforeEnd;
}

function fmtUsd(v: number): string {
  if (v >= 1000) return `$${Math.round(v).toLocaleString("en-US")}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
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
 * Stable Y-range hook.
 *
 * Polymarket's chart doesn't flinch when a tick extends the visible range by
 * a dollar — it re-uses the prior min/max until the new datum clearly falls
 * outside them, then expands with some room to spare. Mimicking that here
 * via a ref keeps micro ticks from flickering the 5 gridlines every second.
 */
function useStableYRange(
  seriesKey: string,
  seriesMin: number,
  seriesMax: number,
  strike: number | null,
) {
  const stateRef = useRef<{ key: string; min: number; max: number } | null>(null);

  const desiredPad = Math.max((seriesMax - seriesMin) * 0.12, seriesMax * 0.0005, 1);
  const strikeMin = strike != null ? Math.min(seriesMin, strike) : seriesMin;
  const strikeMax = strike != null ? Math.max(seriesMax, strike) : seriesMax;
  const targetMin = strikeMin - desiredPad;
  const targetMax = strikeMax + desiredPad;

  const prev = stateRef.current;

  if (!prev || prev.key !== seriesKey) {
    stateRef.current = { key: seriesKey, min: targetMin, max: targetMax };
    return { min: targetMin, max: targetMax };
  }

  // Only expand if new data pokes outside the existing frame with a buffer.
  const buffer = (prev.max - prev.min) * 0.02;
  let { min, max } = prev;
  if (targetMin < prev.min - buffer) min = targetMin;
  if (targetMax > prev.max + buffer) max = targetMax;

  if (min !== prev.min || max !== prev.max) {
    stateRef.current = { key: seriesKey, min, max };
    return { min, max };
  }
  return { min: prev.min, max: prev.max };
}

export function MarketPriceChart({
  symbol,
  marketStartSec,
  marketEndSec,
  strikePriceRaw,
}: {
  symbol: "BTC" | "ETH";
  marketStartSec: number;
  marketEndSec: number;
  strikePriceRaw?: string;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["priceHistory", symbol],
    queryFn: () => getPriceHistory(symbol),
    refetchInterval: 10_000,
  });

  const strikeNum = parseStrikeUsdNumber(strikePriceRaw);
  const strikeLabel = formatStrikeUsd(strikePriceRaw);

  const allPoints = useMemo(() => normalizePriceHistoryData(data), [data]);
  const series = useMemo(
    () => buildSeries(allPoints, marketStartSec, marketEndSec),
    [allPoints, marketStartSec, marketEndSec],
  );

  // Progress indicator — advances 4x/sec. Not a data source, just lets the
  // "now" marker (and the endpoint X, after the last real tick) slide instead
  // of snapping once per WS push.
  const [tickNow, setTickNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setTickNow(Date.now() / 1000), 250);
    return () => clearInterval(id);
  }, []);

  const windowSec = Math.max(60, marketEndSec - marketStartSec);

  const priceMin = series.length ? Math.min(...series.map((p) => p.p)) : 0;
  const priceMax = series.length ? Math.max(...series.map((p) => p.p)) : 0;
  const seriesKey = `${symbol}:${marketStartSec}:${marketEndSec}`;
  const yRange = useStableYRange(seriesKey, priceMin, priceMax, strikeNum);

  const geom = useMemo(() => {
    if (series.length < 2) return null;

    // Lock the X axis to the market window so the chart doesn't pan as time
    // passes — the line grows into a fixed frame instead of dragging the
    // whole scale with it, which is what Polymarket does.
    const t0 = marketStartSec;
    const t1 = marketEndSec;
    const dt = t1 - t0 || 1;

    const pMin = yRange.min;
    const pMax = yRange.max;
    const dp = pMax - pMin || 1;

    const tx = (t: number) =>
      PAD_L + (Math.max(t0, Math.min(t1, t)) - t0) / dt * CHART_W;
    const py = (p: number) => PAD_T + CHART_H - ((p - pMin) / dp) * CHART_H;

    const lineD = series
      .map((pt, i) => `${i === 0 ? "M" : "L"}${tx(pt.t).toFixed(1)},${py(pt.p).toFixed(1)}`)
      .join(" ");

    const xFirst = tx(series[0]!.t);
    const xLast = tx(series[series.length - 1]!.t);
    const baseY = PAD_T + CHART_H;
    const areaD = `${lineD} L${xLast.toFixed(1)},${baseY.toFixed(1)} L${xFirst.toFixed(1)},${baseY.toFixed(1)} Z`;

    const strikeY = strikeNum != null ? py(strikeNum) : null;
    const last = series[series.length - 1]!;
    const above = strikeNum == null ? true : last.p >= strikeNum;

    // The endpoint's "now" X creeps forward between real ticks, so the dot
    // glides along the time axis at a visually continuous rate. Past the
    // last real tick we clamp the X to tickNow but keep the Y at the last
    // known price — the line doesn't extend visually, but the marker slides.
    const endX = tx(Math.max(last.t, Math.min(tickNow, t1)));
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

    return { lineD, areaD, strikeY, above, endX, endY, yLabels, xLabels };
  }, [series, marketStartSec, marketEndSec, strikeNum, tickNow, windowSec, yRange.min, yRange.max]);

  const directionColor = geom?.above ? "var(--up)" : "var(--down)";
  const headerRight =
    strikeNum == null || !geom ? "—" : geom.above ? "UP ▲" : "DOWN ▼";
  const gradId = `pp-chart-grad-${symbol}`;

  return (
    <div
      className="flex flex-col overflow-hidden rounded-[6px] border"
      style={{ background: "var(--bg-1)", borderColor: "var(--border-0)" }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2"
        style={{ borderColor: "var(--border-0)" }}
      >
        <div className="flex items-baseline gap-3">
          <span className="pp-micro">Strike</span>
          <span className="pp-price-md">{strikeLabel}</span>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="pp-micro">Currently</span>
          <span
            className="pp-price-md"
            style={{ color: strikeNum == null || !geom ? "var(--fg-2)" : directionColor }}
          >
            {headerRight}
          </span>
        </div>
      </div>
      <div className="relative min-h-[280px] flex-1">
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
            className="block h-[280px] w-full"
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
                  x={VB_W - PAD_R - 56}
                  y={geom.strikeY - 9}
                  width="52"
                  height="16"
                  fill="var(--bg-0)"
                  stroke="var(--border-1)"
                  strokeWidth="1"
                  rx="2"
                />
                <text
                  x={VB_W - PAD_R - 30}
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

            {/* Endpoint — CSS transform transitions smoothly between WS ticks
                so the marker glides instead of snapping. */}
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

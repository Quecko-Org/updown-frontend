"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPriceHistory } from "@/lib/api";
import { formatStrikeUsd, parseStrikeUsdNumber } from "@/lib/format";
import { clipPointsBetween, normalizePriceHistoryData, type PricePoint } from "@/lib/priceChart";

const VB_W = 640;
const VB_H = 220;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 36;
const PAD_B = 28;
const CHART_W = VB_W - PAD_L - PAD_R;
const CHART_H = VB_H - PAD_T - PAD_B;

function timeLabel(sec: number): string {
  return new Date(sec * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function buildSeries(all: PricePoint[], startSec: number, endSec: number): PricePoint[] {
  const s = clipPointsBetween(all, startSec, endSec);
  if (s.length >= 2) return s;
  const beforeEnd = all.filter((p) => p.t <= endSec);
  const tail = beforeEnd.slice(-80);
  return tail.length >= 2 ? tail : beforeEnd;
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
  const nowSec = Math.floor(Date.now() / 1000);
  const series = useMemo(
    () => buildSeries(allPoints, marketStartSec, marketEndSec),
    [allPoints, marketStartSec, marketEndSec],
  );

  const geom = useMemo(() => {
    if (series.length < 2) return null;
    const ps = series.map((q) => q.p);
    const ts = series.map((q) => q.t);
    const t0 = marketStartSec;
    const t1 = Math.max(marketEndSec, ...ts, nowSec);
    const dt = t1 - t0 || 1;
    const padP = (Math.max(...ps) - Math.min(...ps)) * 0.06 || 1;
    let pMin = Math.min(...ps) - padP;
    let pMax = Math.max(...ps) + padP;
    if (strikeNum != null) {
      pMin = Math.min(pMin, strikeNum);
      pMax = Math.max(pMax, strikeNum);
    }
    const dp = pMax - pMin || 1;

    const tx = (t: number) => PAD_L + ((t - t0) / dt) * CHART_W;
    const py = (p: number) => PAD_T + CHART_H - ((p - pMin) / dp) * CHART_H;

    const lineD = series
      .map((pt, i) => {
        const x = tx(pt.t);
        const y = py(pt.p);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

    let strikeY: number | null = null;
    if (strikeNum != null) {
      strikeY = py(strikeNum);
    }

    const last = series[series.length - 1]!;
    const above = strikeNum == null ? true : last.p >= strikeNum;
    const stroke = above ? "#22c55e" : "#ef4444";
    const fill = above ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)";

    let fillD = "";
    if (strikeY != null) {
      const xLast = tx(series[series.length - 1]!.t);
      const xFirst = tx(series[0]!.t);
      const first = `${tx(series[0]!.t).toFixed(1)},${py(series[0]!.p).toFixed(1)}`;
      const rest = series
        .slice(1)
        .map((pt) => `L ${tx(pt.t).toFixed(1)},${py(pt.p).toFixed(1)}`)
        .join(" ");
      fillD = `M ${first} ${rest} L ${xLast.toFixed(1)},${strikeY.toFixed(1)} L ${xFirst.toFixed(1)},${strikeY.toFixed(1)} Z`;
    }

    const tMid = Math.min(nowSec, marketEndSec);
    const xStart = tx(marketStartSec);
    const xMid = tx(tMid);
    const xEnd = tx(marketEndSec);

    return { lineD, strikeY, stroke, fill, fillD, xStart, xMid, xEnd, above };
  }, [series, marketStartSec, marketEndSec, nowSec, strikeNum]);

  const headerRight =
    strikeNum == null || !geom
      ? "—"
      : geom.above
        ? "Currently: UP ▲"
        : "Currently: DOWN ▼";

  return (
    <div className="panel-dense flex min-h-[240px] flex-col">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-2 py-1.5 text-xs">
        <span className="font-semibold text-foreground">
          Strike: <span className="text-foreground">{strikeLabel}</span>
        </span>
        <span className={cnText(geom?.above)}>{headerRight}</span>
      </div>
      <div className="relative min-h-[200px] flex-1 px-1 pb-1">
        {isLoading && <p className="p-4 text-xs text-muted">Loading chart…</p>}
        {isError && !isLoading && (
          <p className="p-4 text-xs font-medium text-foreground">Price data unavailable</p>
        )}
        {!isLoading && !isError && (!geom || series.length < 2) && (
          <p className="p-4 text-xs text-muted">Not enough price data in this market window.</p>
        )}
        {!isLoading && !isError && geom && series.length >= 2 && (
          <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-[220px] w-full" preserveAspectRatio="xMidYMid meet">
            {geom.strikeY != null && (
              <line
                x1={PAD_L}
                y1={geom.strikeY}
                x2={VB_W - PAD_R}
                y2={geom.strikeY}
                stroke="#9497a9"
                strokeWidth={1}
                strokeDasharray="5 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {geom.strikeY != null && geom.fillD && <path d={geom.fillD} fill={geom.fill} stroke="none" />}
            <path
              d={geom.lineD}
              fill="none"
              stroke={geom.stroke}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            <text x={geom.xStart} y={VB_H - 6} textAnchor="start" className="fill-muted text-[10px]">
              {timeLabel(marketStartSec)}
            </text>
            <text x={geom.xMid} y={VB_H - 6} textAnchor="middle" className="fill-muted text-[10px]">
              {timeLabel(Math.min(nowSec, marketEndSec))}
            </text>
            <text x={geom.xEnd} y={VB_H - 6} textAnchor="end" className="fill-muted text-[10px]">
              {timeLabel(marketEndSec)}
            </text>
          </svg>
        )}
      </div>
    </div>
  );
}

function cnText(above: boolean | undefined): string {
  if (above === undefined) return "font-semibold text-muted";
  return above ? "font-semibold text-success" : "font-semibold text-down";
}

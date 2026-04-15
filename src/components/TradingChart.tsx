"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getPriceHistory } from "@/lib/api";

type Point = { t: number; p: number };

function parseTimeSec(o: Record<string, unknown>): number | null {
  const tRaw = o.time ?? o.t ?? o.ts ?? o.timestamp;
  if (typeof tRaw === "number" && Number.isFinite(tRaw)) {
    return tRaw > 1e12 ? tRaw / 1000 : tRaw;
  }
  if (typeof tRaw === "string" && tRaw) {
    const n = Number(tRaw);
    if (Number.isFinite(n)) return n > 1e12 ? n / 1000 : n;
  }
  const iso = o.createdAt ?? o.updatedAt;
  if (typeof iso === "string" && iso) {
    const ms = Date.parse(iso);
    if (Number.isFinite(ms)) return ms / 1000;
  }
  return null;
}

function parsePrice(o: Record<string, unknown>): number | null {
  const pRaw = o.currentPrice ?? o.price ?? o.close ?? o.value ?? o.p ?? o.last;
  if (typeof pRaw === "string") {
    const n = Number(pRaw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (typeof pRaw === "number" && Number.isFinite(pRaw) && pRaw > 0) return pRaw;
  return null;
}

function rowToPoint(row: unknown): Point | null {
  if (Array.isArray(row) && row.length >= 2) {
    const t = Number(row[0]);
    const p = Number(row[1]);
    if (Number.isFinite(t) && Number.isFinite(p) && p > 0) return { t, p };
    return null;
  }
  if (row && typeof row === "object") {
    const o = row as Record<string, unknown>;
    const t = parseTimeSec(o);
    const p = parsePrice(o);
    if (t != null && p != null) return { t, p };
  }
  return null;
}

function normalizeHistory(raw: unknown): Point[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    const pts = raw.map(rowToPoint).filter((x): x is Point => x !== null);
    pts.sort((a, b) => a.t - b.t);
    return pts;
  }
  if (typeof raw === "object" && raw !== null && "data" in raw) {
    return normalizeHistory((raw as { data: unknown }).data);
  }
  return [];
}

export function TradingChart({ symbol = "BTC" }: { symbol?: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["priceHistory", symbol],
    queryFn: () => getPriceHistory(symbol),
    refetchInterval: 10_000,
  });

  const points = useMemo(() => normalizeHistory(data), [data]);
  const last = points.length ? points[points.length - 1] : null;
  const showSpot = last != null && last.p > 0;

  const pathD = useMemo(() => {
    if (points.length < 2) return "";
    const ys = points.map((pt) => pt.p);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = (maxY - minY) * 0.05 || 1;
    const y0 = minY - pad;
    const y1 = maxY + pad;
    const w = 320;
    const h = 120;
    return points
      .map((pt, i) => {
        const x = (i / (points.length - 1)) * w;
        const y = h - ((pt.p - y0) / (y1 - y0)) * h;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [points]);

  return (
    <div className="card-kraken flex min-h-[220px] flex-col p-5">
      <div className="flex items-baseline justify-between border-b border-border pb-3">
        <h3 className="font-display text-lg font-bold text-foreground">{symbol} spot</h3>
        {showSpot && (
          <span className="font-mono text-lg font-bold tabular-nums text-brand">
            {last!.p.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        )}
      </div>
      <div className="flex min-h-[160px] flex-1 items-center justify-center pt-4">
        {isLoading && <p className="text-sm text-muted">Loading chart…</p>}
        {isError && !isLoading && (
          <p className="max-w-xs text-center text-sm font-medium text-foreground">
            Price data unavailable
          </p>
        )}
        {!isLoading && !isError && points.length < 2 && (
          <p className="max-w-xs text-center text-sm leading-relaxed text-muted">
            No history yet. The price feed may be warming up.
          </p>
        )}
        {!isLoading && !isError && points.length >= 2 && (
          <svg
            viewBox="0 0 320 120"
            className="h-[160px] w-full max-w-full text-brand"
            preserveAspectRatio="none"
          >
            <path
              d={pathD}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>
    </div>
  );
}

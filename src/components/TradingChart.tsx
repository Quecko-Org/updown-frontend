"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getPriceHistory } from "@/lib/api";

type Point = { t: number; p: number };

function normalizeHistory(raw: unknown): Point[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((row) => {
        if (Array.isArray(row) && row.length >= 2) {
          return { t: Number(row[0]), p: Number(row[1]) };
        }
        if (row && typeof row === "object") {
          const o = row as Record<string, unknown>;
          const t = Number(o.time ?? o.t ?? o.ts ?? 0);
          const p = Number(o.price ?? o.close ?? o.value ?? 0);
          if (Number.isFinite(t) && Number.isFinite(p)) return { t, p };
        }
        return null;
      })
      .filter((x): x is Point => x !== null);
  }
  if (typeof raw === "object" && raw !== null && "data" in raw) {
    return normalizeHistory((raw as { data: unknown }).data);
  }
  return [];
}

export function TradingChart({ symbol = "BTC" }: { symbol?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["priceHistory", symbol],
    queryFn: () => getPriceHistory(symbol),
    refetchInterval: 10_000,
  });

  const points = useMemo(() => normalizeHistory(data), [data]);
  const last = points.length ? points[points.length - 1] : null;

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
        {last && (
          <span className="font-mono text-lg font-bold tabular-nums text-brand">
            {last.p.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        )}
      </div>
      <div className="flex min-h-[160px] flex-1 items-center justify-center pt-4">
        {isLoading && <p className="text-sm text-muted">Loading chart…</p>}
        {!isLoading && points.length < 2 && (
          <p className="max-w-xs text-center text-sm leading-relaxed text-muted">
            No history yet. The price feed proxy may be unavailable.
          </p>
        )}
        {!isLoading && points.length >= 2 && (
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

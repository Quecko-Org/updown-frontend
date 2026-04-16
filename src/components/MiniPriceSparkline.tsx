"use client";

import { useMemo } from "react";
import type { PricePoint } from "@/lib/priceChart";

const W = 200;
const H = 48;

/** Compact in-card sparkline with optional strike reference line. */
export function MiniPriceSparkline({
  points,
  strikeUsd,
}: {
  points: PricePoint[];
  strikeUsd: number | null;
}) {
  const { pathD, strikeY, stroke } = useMemo(() => {
    if (points.length < 2) return { pathD: "", strikeY: null as number | null, stroke: "#22c55e" };
    const ts = points.map((q) => q.t);
    const ps = points.map((q) => q.p);
    const t0 = Math.min(...ts);
    const t1 = Math.max(...ts);
    const padP = (Math.max(...ps) - Math.min(...ps)) * 0.08 || 1;
    let pMin = Math.min(...ps) - padP;
    let pMax = Math.max(...ps) + padP;
    if (strikeUsd != null && Number.isFinite(strikeUsd)) {
      pMin = Math.min(pMin, strikeUsd);
      pMax = Math.max(pMax, strikeUsd);
    }
    const dt = t1 - t0 || 1;
    const dp = pMax - pMin || 1;
    const d = points
      .map((pt, i) => {
        const x = ((pt.t - t0) / dt) * W;
        const y = H - ((pt.p - pMin) / dp) * H;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    let sy: number | null = null;
    if (strikeUsd != null && Number.isFinite(strikeUsd)) {
      sy = H - ((strikeUsd - pMin) / dp) * H;
    }
    const last = points[points.length - 1]!;
    const up =
      strikeUsd != null && Number.isFinite(strikeUsd) ? last.p >= strikeUsd : true;
    return { pathD: d, strikeY: sy, stroke: up ? "#22c55e" : "#ef4444" };
  }, [points, strikeUsd]);

  if (points.length < 2) {
    return <div className="h-[48px] w-full rounded border border-border/60 bg-surface-muted/30" />;
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[48px] w-full" preserveAspectRatio="none">
      {strikeY != null && (
        <line
          x1={0}
          y1={strikeY}
          x2={W}
          y2={strikeY}
          stroke="#9497a9"
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <path
        d={pathD}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

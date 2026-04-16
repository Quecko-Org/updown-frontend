"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { MarketListItem } from "@/lib/api";
import { formatStrikeUsd, marketDurationLabel, parseStrikeUsdNumber } from "@/lib/format";
import { clipForMarketCard, type PricePoint } from "@/lib/priceChart";
import { cn } from "@/lib/cn";
import { marketPathFromAddress } from "@/lib/marketKey";
import { MiniPriceSparkline } from "@/components/MiniPriceSparkline";

function useCountdownRemaining(endTime: number) {
  const [left, setLeft] = useState(() => Math.max(0, endTime - Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const t = setInterval(() => {
      setLeft(Math.max(0, endTime - Math.floor(Date.now() / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [endTime]);
  const m = Math.floor(left / 60);
  const s = left % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function bestFromList(m: MarketListItem): { mode: "prices"; bid: string; ask: string } | { mode: "empty" } {
  try {
    const up = BigInt(m.upPrice);
    const down = BigInt(m.downPrice);
    if (up === BigInt(0) && down === BigInt(0)) return { mode: "empty" };
    const upP = Number(up) / 1e18;
    const downP = Number(down) / 1e18;
    if (!Number.isFinite(upP) || !Number.isFinite(downP)) return { mode: "empty" };
    const upC = `${(upP * 100).toFixed(0)}¢`;
    const downC = `${(downP * 100).toFixed(0)}¢`;
    if (upC === "0¢" && downC === "0¢") return { mode: "empty" };
    return { mode: "prices", bid: `UP ${upC}`, ask: `DOWN ${downC}` };
  } catch {
    return { mode: "empty" };
  }
}

function formatUsdInt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function MarketCard({
  market,
  btcPoints,
  spotUsd,
}: {
  market: MarketListItem;
  btcPoints: PricePoint[];
  spotUsd: number | null;
}) {
  const cd = useCountdownRemaining(market.endTime);
  const strikeLabel = formatStrikeUsd(market.strikePrice);
  const strikeNum = parseStrikeUsdNumber(market.strikePrice);
  const quotes = bestFromList(market);
  const pairLabel = (market.pairSymbol ?? market.pairId).replace("-", " / ");
  const title = `${pairLabel} · ${marketDurationLabel(market.duration)}`;

  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(id);
  }, []);

  const miniPoints = useMemo(
    () => clipForMarketCard(btcPoints, market.startTime, market.endTime, nowSec, 900),
    [btcPoints, market.startTime, market.endTime, nowSec],
  );

  const spotLine = useMemo(() => {
    if (spotUsd == null || strikeNum == null) {
      return { text: "—", className: "text-muted" };
    }
    const diff = spotUsd - strikeNum;
    const pct = strikeNum !== 0 ? (diff / strikeNum) * 100 : 0;
    const up = diff >= 0;
    const arrow = up ? "▲" : "▼";
    const sign = diff >= 0 ? "+" : "";
    return {
      text: `${formatUsdInt(spotUsd)} ${arrow} ${sign}${formatUsdInt(Math.abs(diff))} (${sign}${pct.toFixed(2)}%)`,
      className: up ? "text-success" : "text-down",
    };
  }, [spotUsd, strikeNum]);

  return (
    <Link
      href={marketPathFromAddress(market.address)}
      className={cn(
        "panel-dense group block min-h-0 transition-colors hover:border-brand/30",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-display text-base font-bold leading-tight text-foreground sm:text-lg">{title}</h2>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
            market.status === "ACTIVE" ? "bg-success-soft text-success-dark" : "bg-surface-muted text-muted"
          )}
        >
          {market.status}
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold text-foreground">
        Price to Beat: <span className="tabular-nums">{strikeLabel}</span>
      </p>
      <p className={cn("mt-1 text-sm font-semibold tabular-nums", spotLine.className)}>{spotLine.text}</p>
      <div className="mt-2">
        <MiniPriceSparkline points={miniPoints} strikeUsd={strikeNum} />
      </div>
      <div className="mt-2 flex items-end justify-between gap-2 border-t border-border pt-2 text-xs">
        <div>
          <span className="font-mono font-bold tabular-nums text-foreground">{cd}</span>
          <span className="text-muted"> remaining</span>
        </div>
        <div className="text-right">
          {quotes.mode === "empty" ? (
            <span className="text-muted">No orders yet</span>
          ) : (
            <span className="text-foreground">
              <span className="font-semibold text-success">{quotes.bid}</span>
              <span className="text-muted"> / </span>
              <span className="font-semibold text-down">{quotes.ask}</span>
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

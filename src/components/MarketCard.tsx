"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { MarketListItem } from "@/lib/api";
import { formatStrikeUsd } from "@/lib/format";
import { cn } from "@/lib/cn";
import { marketPathFromAddress } from "@/lib/marketKey";

function useCountdown(endTime: number) {
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
    const upC = `${(upP * 100).toFixed(1)}¢`;
    const downC = `${(downP * 100).toFixed(1)}¢`;
    if (upC === "0.0¢" && downC === "0.0¢") return { mode: "empty" };
    return { mode: "prices", bid: `UP ${upC}`, ask: `DOWN ${downC}` };
  } catch {
    return { mode: "empty" };
  }
}

export function MarketCard({ market }: { market: MarketListItem }) {
  const cd = useCountdown(market.endTime);
  const strike = formatStrikeUsd(market.strikePrice);
  const quotes = bestFromList(market);

  return (
    <Link
      href={marketPathFromAddress(market.address)}
      className={cn(
        "card-kraken group block min-w-[280px] shrink-0 snap-start p-5 transition-all duration-200 sm:snap-none sm:min-w-0",
        "hover:shadow-card-hover hover:border-brand/20"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-lg font-bold text-foreground">
            {(market.pairSymbol ?? market.pairId).replace("-", " / ")}
          </p>
          <p className="mt-1 text-xs text-muted">
            Strike{" "}
            <span className="font-semibold text-foreground">{strike}</span>
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-[6px] px-2.5 py-1 text-xs font-bold uppercase tracking-wide",
            market.status === "ACTIVE"
              ? "bg-success-soft text-success-dark"
              : "bg-[rgba(104,107,130,0.12)] text-neutral-ink"
          )}
        >
          {market.status}
        </span>
      </div>
      <div className="mt-4 flex items-end justify-between gap-4 border-t border-border pt-4 text-sm">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Ends in</p>
          <p className="mt-1 font-mono text-xl font-bold tabular-nums text-brand">{cd}</p>
        </div>
        <div className="text-right">
          {quotes.mode === "empty" ? (
            <p className="mt-1 text-sm font-medium text-muted">No orders yet</p>
          ) : (
            <>
              <p className="mt-1 text-sm font-semibold text-success">{quotes.bid}</p>
              <p className="text-sm font-semibold text-down">{quotes.ask}</p>
            </>
          )}
        </div>
      </div>
      {/* Hover hint */}
      <p className="mt-3 text-center text-xs font-medium text-muted opacity-0 transition-opacity group-hover:opacity-100">
        View market →
      </p>
    </Link>
  );
}

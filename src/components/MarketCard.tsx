"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiConfig, MarketListItem } from "@/lib/api";
import { estimateTotalFee, formatShareCentsLabel, sharePriceBpsFromImpliedUp } from "@/lib/feeEstimate";
import { formatStrikeUsd, marketDurationLabel, parseStrikeUsdNumber } from "@/lib/format";
import type { PricePoint } from "@/lib/priceChart";
import { cn } from "@/lib/cn";
import { marketPathFromAddress } from "@/lib/marketKey";

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

const NOTIONAL_PREVIEW = 25;

export function MarketCard({
  market,
  btcPoints = [],
  spotUsd,
  feeConfig,
}: {
  market: MarketListItem;
  /** Optional; reserved for callers / future sparkline. Active cards use live `spotUsd`. */
  btcPoints?: PricePoint[];
  spotUsd: number | null;
  feeConfig?: Pick<ApiConfig, "platformFeeBps" | "makerFeeBps" | "feeModel" | "peakFeeBps"> | null;
}) {
  void btcPoints;
  const router = useRouter();
  const marketHref = marketPathFromAddress(market.address);
  const cd = useCountdownRemaining(market.endTime);
  const strikeLabel = formatStrikeUsd(market.strikePrice);
  const strikeNum = parseStrikeUsdNumber(market.strikePrice);
  const quotes = bestFromList(market);
  const pairLabel = (market.pairSymbol ?? market.pairId).replace("-", " / ");
  const title = `${pairLabel} · ${marketDurationLabel(market.duration)}`;

  const feePreview = useMemo(() => {
    if (!feeConfig) return null;
    const totalBps = feeConfig.platformFeeBps + feeConfig.makerFeeBps;
    const shareBps = sharePriceBpsFromImpliedUp(market.upPrice, market.downPrice);
    const { feeUsd, effectivePercentOfNotional } = estimateTotalFee(
      NOTIONAL_PREVIEW,
      totalBps,
      shareBps,
      feeConfig.feeModel,
    );
    const peak = feeConfig.peakFeeBps ?? totalBps;
    return {
      feeUsd,
      effectivePercentOfNotional,
      shareLabel: formatShareCentsLabel(shareBps),
      peakPct: (peak / 100).toFixed(2),
    };
  }, [feeConfig, market.upPrice, market.downPrice]);

  const spotLine = useMemo(() => {
    const isResolved = market.status === "RESOLVED" || market.status === "CLAIMED";

    let displayPrice: number | null = null;
    if (isResolved && market.settlementPrice) {
      displayPrice = parseStrikeUsdNumber(market.settlementPrice);
    } else {
      displayPrice = spotUsd;
    }

    if (displayPrice == null || strikeNum == null) {
      return { text: "—", className: "text-muted" };
    }
    const diff = displayPrice - strikeNum;
    const pct = strikeNum !== 0 ? (diff / strikeNum) * 100 : 0;
    const up = diff >= 0;
    const arrow = up ? "▲" : "▼";
    const sign = diff >= 0 ? "+" : "";
    return {
      text: `${formatUsdInt(displayPrice)} ${arrow} ${sign}${formatUsdInt(Math.abs(diff))} (${sign}${pct.toFixed(2)}%)`,
      className: up ? "text-success" : "text-down",
    };
  }, [spotUsd, strikeNum, market.status, market.settlementPrice]);

  const resolvedOrClaimed =
    (market.status === "RESOLVED" || market.status === "CLAIMED") && market.winner != null && market.winner !== 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(marketHref)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(marketHref);
        }
      }}
      className={cn(
        "panel-dense group min-h-0 cursor-pointer transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        market.status === "ACTIVE"
          ? "border-2 border-brand/40 shadow-sm hover:border-brand/60"
          : "border border-border opacity-70 hover:opacity-90",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-display text-base font-bold leading-tight text-foreground sm:text-lg">{title}</h2>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
            market.status === "ACTIVE" ? "bg-success-soft text-success-dark" : "bg-surface-muted text-muted",
          )}
        >
          {market.status}
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold text-foreground">
        Price to Beat: <span className="tabular-nums">{strikeLabel}</span>
      </p>
      <p className={cn("mt-1 text-sm font-semibold tabular-nums", spotLine.className)}>
        {market.status === "RESOLVED" || market.status === "CLAIMED" ? "Settled: " : ""}
        {spotLine.text}
      </p>
      {market.status === "ACTIVE" ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-lg bg-success/10 py-2 text-center text-sm font-bold text-success transition-colors hover:bg-success/20"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              router.push(`${marketHref}?side=1&amount=25`);
            }}
          >
            ▲ UP
          </button>
          <button
            type="button"
            className="flex-1 rounded-lg bg-down/10 py-2 text-center text-sm font-bold text-down transition-colors hover:bg-down/20"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              router.push(`${marketHref}?side=2&amount=25`);
            }}
          >
            ▼ DOWN
          </button>
        </div>
      ) : null}
      {resolvedOrClaimed ? (
        <div
          className={cn(
            "mt-2 rounded-lg py-2 text-center text-sm font-bold",
            market.winner === 1 ? "bg-success/10 text-success" : "bg-down/10 text-down",
          )}
        >
          {market.winner === 1 ? "▲ UP Won" : "▼ DOWN Won"}
        </div>
      ) : null}
      {market.status === "TRADING_ENDED" ? (
        <div className="mt-2 rounded-lg bg-surface-muted py-2 text-center text-sm font-semibold text-muted">
          Resolving…
        </div>
      ) : null}
      <div className="mt-2 flex items-end justify-between gap-2 border-t border-border pt-2 text-xs">
        <div>
          {market.status === "ACTIVE" ? (
            <>
              <span className="font-mono font-bold tabular-nums text-foreground">{cd}</span>
              <span className="text-muted"> remaining</span>
            </>
          ) : (
            <span className="text-xs text-muted">Ended</span>
          )}
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
      {feePreview ? (
        <p
          className="mt-1.5 border-t border-border pt-1.5 text-[10px] text-muted"
          title={`Peak ~${feePreview.peakPct}% at 50¢`}
        >
          Fee on ${NOTIONAL_PREVIEW}:{" "}
          <span className="font-medium text-foreground">
            ~${feePreview.feeUsd.toFixed(2)} ({feePreview.effectivePercentOfNotional.toFixed(2)}% at{" "}
            {feePreview.shareLabel})
          </span>
        </p>
      ) : null}
    </div>
  );
}

"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiConfig, MarketListItem } from "@/lib/api";
import { estimateTotalFee, formatShareCentsLabel, sharePriceBpsFromImpliedUp } from "@/lib/feeEstimate";
import { formatStrikeUsd, marketDurationLabel, parseStrikeUsdNumber } from "@/lib/format";
import type { PricePoint } from "@/lib/priceChart";
import { cn } from "@/lib/cn";
import { deriveEffectiveStatus } from "@/lib/derivations";
import { marketPathFromAddress } from "@/lib/marketKey";

function useCountdownRemaining(endTime: number) {
  const [left, setLeft] = useState(() => Math.max(0, endTime - Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const t = setInterval(() => {
      // Functional update + same-value short-circuit: once `left` hits 0, React
      // skips re-rendering on subsequent ticks (no flicker from wasted renders
      // that race with the WS-driven RESOLVED transition).
      setLeft((prev) => {
        const next = Math.max(0, endTime - Math.floor(Date.now() / 1000));
        return next === prev ? prev : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [endTime]);
  const m = Math.floor(left / 60);
  const s = left % 60;
  return { label: `${m}:${s.toString().padStart(2, "0")}`, urgent: left > 0 && left < 60 };
}

function centsFromRaw(raw: string): number | null {
  try {
    const v = BigInt(raw);
    if (v === BigInt(0)) return null;
    const p = Number(v) / 1e18;
    if (!Number.isFinite(p)) return null;
    return Math.round(p * 100);
  } catch {
    return null;
  }
}

function formatUsdInt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

const NOTIONAL_PREVIEW = 25;

function pairIconSlug(pairSymbol: string | undefined, pairId: string): string {
  const base = (pairSymbol ?? pairId).split("-")[0]?.toLowerCase() ?? "btc";
  return ["btc", "eth"].includes(base) ? base : "btc";
}

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
  const { label: cdLabel, urgent: cdUrgent } = useCountdownRemaining(market.endTime);
  const effectiveStatus = deriveEffectiveStatus(market.status, cdLabel);
  const strikeLabel = formatStrikeUsd(market.strikePrice);
  const strikeNum = parseStrikeUsdNumber(market.strikePrice);
  const pairBase = (market.pairSymbol ?? market.pairId).split("-")[0] ?? "BTC";
  const pairLabel = `${pairBase}/USD`;
  const tfLabel = marketDurationLabel(market.duration);
  const iconSlug = pairIconSlug(market.pairSymbol, market.pairId);

  const upCents = centsFromRaw(market.upPrice);
  const downCents = centsFromRaw(market.downPrice);

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

  const isResolved = market.status === "RESOLVED" || market.status === "CLAIMED";
  const resolving = !isResolved && effectiveStatus !== "ACTIVE";

  const displayPrice: number | null = useMemo(() => {
    if (resolving) return null;
    if (isResolved && market.settlementPrice) return parseStrikeUsdNumber(market.settlementPrice);
    return spotUsd;
  }, [spotUsd, market.settlementPrice, isResolved, resolving]);

  const diffUsd = displayPrice != null && strikeNum != null ? displayPrice - strikeNum : null;
  const diffPct = diffUsd != null && strikeNum ? (diffUsd / strikeNum) * 100 : null;
  const deltaUp = diffUsd != null && diffUsd >= 0;

  const resolvedOrClaimed = isResolved && market.winner != null && market.winner !== 0;
  const resolvedUp = market.winner === 1;

  const onOpen = () => router.push(marketHref);

  // ---------------------------- RESOLVED / CLAIMED ----------------------------
  if (resolvedOrClaimed) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className="pp-tile pp-tile--closed"
      >
        <div className="pp-tile__top">
          <div className="pp-tile__ticker">
            <Image src={`/icons/crypto/${iconSlug}.svg`} alt="" width={16} height={16} />
            <span className="pp-tile__pair">
              {pairLabel} · <span style={{ color: "var(--fg-2)" }}>{tfLabel}</span>
            </span>
          </div>
          <span className="pp-chip pp-chip--closed">RESOLVED</span>
        </div>

        <div className={cn("pp-tile__outcome", resolvedUp ? "pp-tile__outcome--up" : "pp-tile__outcome--down")}>
          <span className="pp-tile__outcome-arrow">{resolvedUp ? "▲" : "▼"}</span>
          <span className="pp-tile__outcome-label">{resolvedUp ? "UP won" : "DOWN won"}</span>
        </div>

        <div className="pp-tile__settlegrid">
          <div>
            <span className="pp-micro">Strike</span>
            <span className="pp-tile__num">{strikeLabel}</span>
          </div>
          <div>
            <span className="pp-micro">Settled</span>
            <span className="pp-tile__num">
              {market.settlementPrice ? formatStrikeUsd(market.settlementPrice) : "—"}
            </span>
          </div>
          <div>
            <span className="pp-micro">Δ</span>
            <span className={cn("pp-tile__num", deltaUp ? "pp-up" : "pp-down")}>
              {diffPct != null
                ? `${deltaUp ? "+" : "−"}${Math.abs(diffPct).toFixed(2)}%`
                : "—"}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------- ACTIVE / RESOLVING ----------------------------
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn("pp-tile", effectiveStatus === "ACTIVE" && "pp-tile--live")}
    >
      <div className="pp-tile__top">
        <div className="pp-tile__ticker">
          <Image src={`/icons/crypto/${iconSlug}.svg`} alt="" width={16} height={16} />
          <span className="pp-tile__pair">
            {pairLabel} · <span style={{ color: "var(--fg-2)" }}>{tfLabel}</span>
          </span>
        </div>
        {effectiveStatus === "ACTIVE" ? (
          <span className={cn("pp-chip pp-chip--cd", cdUrgent && "pp-chip--cd-urgent")}>
            <span className="pp-chip__pulse" />
            <span className="pp-tabular">{cdLabel}</span>
          </span>
        ) : (
          <span className="pp-chip pp-chip--closed">{effectiveStatus}</span>
        )}
      </div>

      <div className="pp-tile__pricerow">
        <div className={cn("pp-tile__spot", deltaUp ? "pp-up" : "pp-down")}>
          {displayPrice != null
            ? displayPrice.toLocaleString("en-US", {
                style: "currency",
                currency: "USD",
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : "—"}
        </div>
        <div className="pp-tile__stripe">
          <span className="pp-micro">Strike</span>
          <span className="pp-price-md">{strikeLabel}</span>
          {diffUsd != null && diffPct != null ? (
            <span className={cn("pp-tile__delta", deltaUp ? "pp-up" : "pp-down")}>
              {deltaUp ? "▲" : "▼"} {deltaUp ? "+" : ""}
              {formatUsdInt(Math.abs(diffUsd))} ({deltaUp ? "+" : "−"}
              {Math.abs(diffPct).toFixed(2)}%)
            </span>
          ) : (
            <span className="pp-tile__delta" style={{ color: "var(--fg-2)" }}>
              {resolving ? "Awaiting settlement" : "—"}
            </span>
          )}
        </div>
      </div>

      {effectiveStatus === "ACTIVE" ? (
        <div className="pp-tile__ladder">
          <button
            type="button"
            className="pp-tile__side pp-tile__side--up"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              router.push(`${marketHref}?side=1&amount=25`);
            }}
          >
            <span className="pp-tile__side-label">▲ UP</span>
            <span className="pp-tile__side-price">{upCents != null ? `${upCents}¢` : "—"}</span>
          </button>
          <button
            type="button"
            className="pp-tile__side pp-tile__side--down"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              router.push(`${marketHref}?side=2&amount=25`);
            }}
          >
            <span className="pp-tile__side-label">▼ DOWN</span>
            <span className="pp-tile__side-price">{downCents != null ? `${downCents}¢` : "—"}</span>
          </button>
        </div>
      ) : null}

      {resolving ? (
        <div
          className="pp-tile__outcome"
          style={{ background: "var(--bg-2)", color: "var(--fg-2)" }}
        >
          <span className="pp-tile__outcome-label">Awaiting settlement</span>
        </div>
      ) : null}

      <div className="pp-tile__foot">
        {effectiveStatus === "ACTIVE" ? (
          <span className="pp-caption">
            <span className="pp-tabular" style={{ color: "var(--fg-0)" }}>
              {cdLabel}
            </span>{" "}
            remaining
          </span>
        ) : (
          <span className="pp-caption">Ended</span>
        )}
        {feePreview ? (
          <span
            className="pp-caption"
            title={`Peak ~${feePreview.peakPct}% at 50¢`}
          >
            Fee on ${NOTIONAL_PREVIEW}:{" "}
            <span className="pp-tabular" style={{ color: "var(--fg-0)" }}>
              ~${feePreview.feeUsd.toFixed(2)}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

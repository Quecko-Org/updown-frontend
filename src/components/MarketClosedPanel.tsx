"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getMarkets, type MarketListItem } from "@/lib/api";
import { formatStrikeUsd, marketDurationLabel } from "@/lib/format";
import { formatResolutionOutcome } from "@/lib/derivations";
import { marketPathFromAddress } from "@/lib/marketKey";

/**
 * Replaces TradeForm when the market is in a terminal state (RESOLVED, CLAIMED,
 * TRADING_ENDED). Phase2-PRE bug fix — previously the trade form rendered the
 * full Buy/Sell UI on resolved markets and the submit button only blocked on
 * disabled, while the rest of the panel (UP/DOWN selector, fee math preview,
 * size input) stayed interactive and visually identical to the live state.
 *
 * Surfaces:
 *   - Outcome badge (UP won / DOWN won / "awaiting settlement" for TRADING_ENDED)
 *   - Settled price when available
 *   - "Go to live market" CTA pointing to the active market for the same
 *     pair + timeframe (or homepage if no active market exists right now —
 *     dev cron-upkeep gap, or genuine quiet between cycles).
 */
export function MarketClosedPanel({ market }: { market: MarketListItem }) {
  const pairId = market.pairId as "BTC-USD" | "ETH-USD";
  const duration = market.duration as 300 | 900 | 3600;
  const validTfQuery =
    duration === 300 || duration === 900 || duration === 3600;

  const { data: liveCandidates } = useQuery({
    queryKey: ["markets", duration, pairId],
    queryFn: () => getMarkets(duration, pairId),
    staleTime: 30_000,
    enabled: validTfQuery,
  });

  const activeMarket = liveCandidates?.find((m) => m.status === "ACTIVE");

  const outcome = formatResolutionOutcome(market);
  const pairBase = (market.pairSymbol ?? market.pairId).split("-")[0] ?? "BTC";
  const tfLabel = marketDurationLabel(duration);
  const liveHref = activeMarket ? marketPathFromAddress(activeMarket.address) : "/";

  return (
    <div className="pp-panel pp-trade">
      <div className="pp-micro" style={{ color: "var(--fg-2)" }}>
        Market closed
      </div>

      {outcome.winnerLabel ? (
        <div
          style={{
            marginTop: 12,
            padding: 16,
            borderRadius: 6,
            background:
              outcome.winnerSide === 1 ? "var(--up-bg)" : "var(--down-bg)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 22,
              fontWeight: 600,
              color: outcome.winnerSide === 1 ? "var(--up)" : "var(--down)",
            }}
          >
            {outcome.winnerSide === 1 ? "▲ UP won" : "▼ DOWN won"}
          </span>
          {market.settlementPrice ? (
            <span className="pp-caption" style={{ color: "var(--fg-2)" }}>
              Settled at {formatStrikeUsd(market.settlementPrice)}
            </span>
          ) : null}
          {outcome.deltaStr ? (
            <span
              className="pp-caption pp-tabular"
              style={{ color: "var(--fg-2)" }}
              title={
                outcome.deltaUsedFinePrecision
                  ? "Sub-cent gap — extra precision shown so the result is unambiguous"
                  : undefined
              }
            >
              Δ {outcome.deltaStr}
            </span>
          ) : null}
        </div>
      ) : (
        <div
          style={{
            marginTop: 12,
            padding: 16,
            borderRadius: 6,
            background: "var(--bg-2)",
          }}
        >
          <span className="pp-body" style={{ color: "var(--fg-1)" }}>
            Trading ended — awaiting on-chain settlement.
          </span>
        </div>
      )}

      <Link
        href={liveHref}
        className="pp-btn pp-btn--primary pp-btn--lg pp-trade__cta"
        style={{ marginTop: 16 }}
      >
        {activeMarket
          ? `Go to live ${pairBase}/USD ${tfLabel} market`
          : `Browse all markets`}
      </Link>

      <p className="pp-caption" style={{ color: "var(--fg-2)", marginTop: 12 }}>
        New trades on this market are no longer accepted. Open positions
        already settled are visible from your portfolio.
      </p>
    </div>
  );
}

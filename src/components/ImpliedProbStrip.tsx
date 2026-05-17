"use client";

import { useMemo } from "react";
import { cn } from "@/lib/cn";
import type { MarketDetail } from "@/lib/api";
import { sharePriceBpsFromOrderBookMid } from "@/lib/feeEstimate";

/**
 * Phase2-G: snapshot-only implied probability readout under the price chart.
 * Reads UP/DOWN cents from the market's orderbook mid (the same source the
 * trade panel uses for the BIG Up/Down buttons), so the strip stays in
 * lock-step with the trader's quoted prices.
 *
 * Snapshot-only — no historical mid series exists yet (orderbook history
 * isn't persisted). Updates re-render when the WS push invalidates the
 * `["market", marketKey]` query that drives the parent. No additional
 * fetch / subscription needed.
 *
 * Empty-side fallback: when one outcome has no resting bids/asks,
 * `sharePriceBpsFromOrderBookMid` returns 5000 (50¢) so the bar still
 * renders meaningfully — labeled "indicative" so the user knows the
 * book on that side is empty.
 *
 * 2026-05-17 detail-page redesign: layout migrated from raw Tailwind +
 * inline styles to the `pp-prob-strip*` token block.
 */
export function ImpliedProbStrip({ market }: { market: MarketDetail }) {
  const { upCents, downCents, upIndicative, downIndicative } = useMemo(() => {
    const ob = market.orderBook;
    const upHasBook = !!(ob.up.bestBid || ob.up.bestAsk);
    const downHasBook = !!(ob.down.bestBid || ob.down.bestAsk);
    const upBps = sharePriceBpsFromOrderBookMid(1, ob);
    const downBps = sharePriceBpsFromOrderBookMid(2, ob);
    return {
      upCents: upBps / 100,
      downCents: downBps / 100,
      upIndicative: !upHasBook,
      downIndicative: !downHasBook,
    };
  }, [market.orderBook]);

  const total = Math.max(1, upCents + downCents);
  const upPct = (upCents / total) * 100;
  const downPct = (downCents / total) * 100;

  return (
    <div className="pp-prob-strip" role="group" aria-label="Implied probability">
      <div className="pp-prob-strip__head">
        <span className="pp-micro">Implied probability</span>
        <span className="pp-caption pp-prob-strip__live-mid">live mid</span>
      </div>
      <div className="pp-prob-strip__body">
        <div className="pp-prob-strip__side pp-prob-strip__side--up">
          <span className="pp-prob-strip__label pp-up">▲ Up</span>
          <span className="pp-prob-strip__cents pp-tabular">{upCents.toFixed(0)}¢</span>
          {upIndicative ? (
            <span className="pp-prob-strip__indicative pp-caption">indicative</span>
          ) : null}
        </div>
        <div className="pp-prob-strip__track">
          <div
            className={cn(
              "pp-prob-strip__fill",
              "pp-prob-strip__fill--up",
              upIndicative && "pp-prob-strip__fill--indicative",
            )}
            style={{ width: `${upPct}%` }}
          />
          <div
            className={cn(
              "pp-prob-strip__fill",
              "pp-prob-strip__fill--down",
              downIndicative && "pp-prob-strip__fill--indicative",
            )}
            style={{ width: `${downPct}%` }}
          />
        </div>
        <div className="pp-prob-strip__side pp-prob-strip__side--down">
          <span className="pp-prob-strip__cents pp-tabular">{downCents.toFixed(0)}¢</span>
          <span className="pp-prob-strip__label pp-down">Down ▼</span>
          {downIndicative ? (
            <span className="pp-prob-strip__indicative pp-caption">indicative</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

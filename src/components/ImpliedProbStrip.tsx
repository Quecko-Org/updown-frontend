"use client";

import { useMemo } from "react";
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

  // Stacked bar: UP cents on the left, DOWN cents on the right. Cents sum
  // to ~100 in a healthy book; we render proportionally either way so the
  // bar is visually correct even when the book is one-sided.
  const total = Math.max(1, upCents + downCents);
  const upPct = (upCents / total) * 100;
  const downPct = (downCents / total) * 100;

  return (
    <div
      className="rounded-[var(--r-lg)] border px-3 py-2"
      style={{ background: "var(--bg-1)", borderColor: "var(--border-0)" }}
      role="group"
      aria-label="Implied probability"
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="pp-micro" style={{ color: "var(--fg-2)" }}>
          Implied probability
        </span>
        <span className="pp-caption" style={{ color: "var(--fg-2)" }}>
          live mid
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-baseline gap-1.5">
          <span className="pp-up" style={{ fontWeight: 600 }}>
            ▲ Up
          </span>
          <span
            className="pp-tabular"
            style={{ color: "var(--fg-0)", fontWeight: 600 }}
          >
            {upCents.toFixed(0)}¢
          </span>
          {upIndicative ? (
            <span className="pp-caption" style={{ color: "var(--fg-2)" }}>
              indicative
            </span>
          ) : null}
        </div>
        <div
          className="relative h-2 flex-1 overflow-hidden rounded-full"
          style={{ background: "var(--bg-0)", border: "1px solid var(--border-0)" }}
        >
          <div
            className="absolute left-0 top-0 h-full"
            style={{
              width: `${upPct}%`,
              background: "var(--up)",
              opacity: upIndicative ? 0.5 : 0.85,
            }}
          />
          <div
            className="absolute right-0 top-0 h-full"
            style={{
              width: `${downPct}%`,
              background: "var(--down)",
              opacity: downIndicative ? 0.5 : 0.85,
            }}
          />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span
            className="pp-tabular"
            style={{ color: "var(--fg-0)", fontWeight: 600 }}
          >
            {downCents.toFixed(0)}¢
          </span>
          <span className="pp-down" style={{ fontWeight: 600 }}>
            Down ▼
          </span>
          {downIndicative ? (
            <span className="pp-caption" style={{ color: "var(--fg-2)" }}>
              indicative
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

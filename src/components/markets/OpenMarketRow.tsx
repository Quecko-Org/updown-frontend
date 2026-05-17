"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { MarketListItem } from "@/lib/api";
import { formatStrikeUsd } from "@/lib/format";
import { marketPathFromAddress } from "@/lib/marketKey";

export type OpenMarketRowProps = {
  market: MarketListItem;
  upSharePriceCents: number;
  downSharePriceCents: number;
  /** See LiveMarketRow — null when no trades yet, source-of-truth moves to orderbook mid in PR-5. */
  upPct: number | null;
  downPct: number | null;
  poolUsdt: number;
  traderCount: number;
  countdownSecondsUntilClose: number;
};

function formatTimeRange(startSec: number, endSec: number): string {
  // See LiveMarketRow — single AM/PM suffix at the end fits the 180px col.
  const start = new Date(startSec * 1000);
  const end = new Date(endSec * 1000);
  const full = end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  const [h, m] = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: false }).split(":");
  const hourNum = ((Number(h) + 11) % 12) + 1;
  return `${hourNum}:${m} – ${full}`;
}

function formatOpensAt(strikePrice: string | undefined, decimals: number | undefined): string {
  const formatted = formatStrikeUsd(strikePrice, decimals);
  return formatted === "Pending" ? "Opens at —" : `Opens at ${formatted}`;
}

function formatPool(usdt: number): string {
  if (!Number.isFinite(usdt)) return "$—";
  return `$${usdt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function OpenMarketRow({
  market,
  upSharePriceCents,
  downSharePriceCents,
  upPct,
  downPct,
  poolUsdt,
  traderCount,
  countdownSecondsUntilClose,
}: OpenMarketRowProps) {
  void countdownSecondsUntilClose;
  const marketHref = marketPathFromAddress(market.address);
  // 2026-05-16 BUG A redesign: clicking UP/DOWN navigates to the market
  // detail page with the side pre-selected via `?side=up|down`. The
  // legacy `TradeDrawer` slide-in (which only logged its submit) is
  // removed; the right-column `TradeForm` on the detail page is now the
  // single trade UI surface. Mirrors LiveMarketRowContainer's Link
  // pattern so the whole row + buttons share one nav target.
  return (
    <div className="pp-market-row pp-market-row--open">
      <Link
        href={marketHref}
        className="pp-market-row__cover-link"
        aria-label={`Open market detail for ${market.address}`}
      />
      <div>
        <div className="pp-market-row__time">
          {formatTimeRange(market.startTime, market.endTime)}
        </div>
        <div className="pp-market-row__strike">{formatOpensAt(market.strikePrice, market.strikeDecimals)}</div>
      </div>

      <div>
        <div className="pp-market-row__buy-buttons">
          <Link
            href={`${marketHref}?side=up`}
            className="pp-btn pp-btn--up pp-btn--lg pp-market-row__buy-link"
          >
            <ArrowUp size={14} />
            <span>UP</span>
            <span className="pp-market-row__buy-btn-price">{upSharePriceCents}¢</span>
          </Link>
          <Link
            href={`${marketHref}?side=down`}
            className="pp-btn pp-btn--down pp-btn--lg pp-market-row__buy-link"
          >
            <ArrowDown size={14} />
            <span>DOWN</span>
            <span className="pp-market-row__buy-btn-price">{downSharePriceCents}¢</span>
          </Link>
        </div>

        {upPct != null && downPct != null && (
          <div className="pp-market-row__pct-bar" style={{ minWidth: 0, marginTop: 8 }}>
            <div className="pp-market-row__pct-bar-track" style={{ width: 220, height: 4 }}>
              <div className="pp-up-fill" style={{ width: `${upPct}%` }} />
              <div className="pp-down-fill" style={{ width: `${downPct}%` }} />
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="pp-market-row__pool">{formatPool(poolUsdt)}</div>
        <div className="pp-market-row__traders">{traderCount} traders</div>
      </div>
    </div>
  );
}

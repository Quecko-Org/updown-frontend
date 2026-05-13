"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import type { MarketListItem } from "@/lib/api";

export type OpenMarketRowProps = {
  market: MarketListItem;
  upSharePriceCents: number;
  downSharePriceCents: number;
  upPct: number;
  downPct: number;
  poolUsdt: number;
  traderCount: number;
  countdownSecondsUntilClose: number;
  onSelectSide: (side: "up" | "down") => void;
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

function formatOpensAt(strikePrice: string | undefined): string {
  if (!strikePrice) return "Opens at —";
  const n = Number(strikePrice);
  if (!Number.isFinite(n)) return "Opens at —";
  return `Opens at $${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
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
  onSelectSide,
}: OpenMarketRowProps) {
  void countdownSecondsUntilClose;
  return (
    <div className="pp-market-row pp-market-row--open">
      <div>
        <div className="pp-market-row__time">
          {formatTimeRange(market.startTime, market.endTime)}
        </div>
        <div className="pp-market-row__strike">{formatOpensAt(market.strikePrice)}</div>
      </div>

      <div>
        <div className="pp-market-row__buy-buttons">
          <button
            type="button"
            className="pp-btn pp-btn--up pp-btn--lg"
            onClick={() => onSelectSide("up")}
          >
            <ArrowUp size={14} />
            <span>UP</span>
            <span className="pp-market-row__buy-btn-price">{upSharePriceCents}¢</span>
          </button>
          <button
            type="button"
            className="pp-btn pp-btn--down pp-btn--lg"
            onClick={() => onSelectSide("down")}
          >
            <ArrowDown size={14} />
            <span>DOWN</span>
            <span className="pp-market-row__buy-btn-price">{downSharePriceCents}¢</span>
          </button>
        </div>

        <div className="pp-market-row__pct-bar" style={{ minWidth: 0, marginTop: 8 }}>
          <div className="pp-market-row__pct-bar-track" style={{ width: 220, height: 4 }}>
            <div className="pp-up-fill" style={{ width: `${upPct}%` }} />
            <div className="pp-down-fill" style={{ width: `${downPct}%` }} />
          </div>
        </div>
      </div>

      <div>
        <div className="pp-market-row__pool">{formatPool(poolUsdt)}</div>
        <div className="pp-market-row__traders">{traderCount} traders</div>
      </div>
    </div>
  );
}

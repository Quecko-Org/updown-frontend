import { Clock } from "lucide-react";
import type { MarketListItem } from "@/lib/api";

export type LiveMarketRowProps = {
  market: MarketListItem;
  countdownSeconds: number;
  upTraderCount: number;
  downTraderCount: number;
  upPct: number;
  downPct: number;
};

function formatTimeRange(startSec: number, endSec: number): string {
  const fmt = (s: number) =>
    new Date(s * 1000).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  return `${fmt(startSec)} – ${fmt(endSec)}`;
}

function formatMmSs(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m:${String(r).padStart(2, "0")}s`;
}

function formatStrike(strikePrice: string | undefined): string {
  if (!strikePrice) return "Strike —";
  const n = Number(strikePrice);
  if (!Number.isFinite(n)) return "Strike —";
  return `Strike $${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatPool(volume: string): string {
  const n = Number(volume);
  if (!Number.isFinite(n)) return "$—";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function LiveMarketRow({
  market,
  countdownSeconds,
  upTraderCount,
  downTraderCount,
  upPct,
  downPct,
}: LiveMarketRowProps) {
  const traders = upTraderCount + downTraderCount;
  return (
    <div className="pp-market-row pp-market-row--live">
      <div className="pp-market-row__timer">
        <Clock size={12} />
        <span>{formatMmSs(countdownSeconds)}</span>
      </div>

      <div>
        <div className="pp-market-row__time">
          {formatTimeRange(market.startTime, market.endTime)}
        </div>
        <div className="pp-market-row__strike">{formatStrike(market.strikePrice)}</div>
      </div>

      <div className="pp-market-row__counters">
        <span className="pp-market-row__count-chip pp-market-row__count-chip--up">
          <span>UP</span>
          <span>{upTraderCount}</span>
        </span>

        <div className="pp-market-row__pct-bar">
          <div className="pp-market-row__pct-bar-row">
            <span className="pp-up">{Math.round(upPct)}%</span>
            <div className="pp-market-row__pct-bar-track">
              <div className="pp-up-fill" style={{ width: `${upPct}%` }} />
              <div className="pp-down-fill" style={{ width: `${downPct}%` }} />
            </div>
            <span className="pp-down">{Math.round(downPct)}%</span>
          </div>
          <div className="pp-market-row__pct-label">Counting</div>
        </div>

        <span className="pp-market-row__count-chip pp-market-row__count-chip--down">
          <span>{downTraderCount}</span>
          <span>DOWN</span>
        </span>
      </div>

      <div>
        <div className="pp-market-row__pool">{formatPool(market.volume)}</div>
        <div className="pp-market-row__traders">{traders} traders</div>
      </div>
    </div>
  );
}

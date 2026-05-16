import { Clock } from "lucide-react";
import type { MarketListItem } from "@/lib/api";
import { formatStrikeUsd } from "@/lib/format";

export type LiveMarketRowProps = {
  market: MarketListItem;
  countdownSeconds: number;
  upTraderCount: number;
  downTraderCount: number;
  /**
   * Implied probabilities computed by the page from pool totals. Null
   * when no trades have happened yet (both pools 0) — the row renders
   * "—" in that case rather than the lying "0%". Source-of-truth for
   * ACTIVE markets moves to orderbook mid in PR-5.
   */
  upPct: number | null;
  downPct: number | null;
};

function formatTimeRange(startSec: number, endSec: number): string {
  // Format as "3:59 – 4:04 PM" — single AM/PM suffix at the end so the
  // string fits the 180px column without wrapping at narrow widths.
  const start = new Date(startSec * 1000);
  const end = new Date(endSec * 1000);
  const full = end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  const startTime = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: false });
  const [h, m] = startTime.split(":");
  const hourNum = ((Number(h) + 11) % 12) + 1;
  return `${hourNum}:${m} – ${full}`;
}

function formatMmSs(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m:${String(r).padStart(2, "0")}s`;
}

function formatStrike(strikePrice: string | undefined): string {
  const formatted = formatStrikeUsd(strikePrice);
  return formatted === "Pending" ? "Strike —" : `Strike ${formatted}`;
}

function formatPool(volume: string): string {
  const n = Number(volume);
  if (!Number.isFinite(n)) return "$—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
          {upPct == null || downPct == null ? (
            <div className="pp-market-row__pct-bar-row">
              <span className="pp-up">—</span>
              <span className="pp-market-row__pct-label" style={{ marginTop: 0 }}>
                no trades yet
              </span>
              <span className="pp-down">—</span>
            </div>
          ) : (
            <>
              <div className="pp-market-row__pct-bar-row">
                <span className="pp-up">{upPct}%</span>
                <div className="pp-market-row__pct-bar-track">
                  <div className="pp-up-fill" style={{ width: `${upPct}%` }} />
                  <div className="pp-down-fill" style={{ width: `${downPct}%` }} />
                </div>
                <span className="pp-down">{downPct}%</span>
              </div>
              <div className="pp-market-row__pct-label">Counting</div>
            </>
          )}
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

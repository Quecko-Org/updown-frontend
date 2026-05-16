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
  /**
   * pr-fix-3 (2026-05-16) Issue 6: when `market.status` is RESOLVED or
   * CLAIMED, the row swaps from the "live trading" treatment (UP%/DOWN%
   * bar) to a Polymarket-style outcome treatment showing which side won.
   * `variant="resolved"` is the explicit toggle; left as `"live"` for
   * ACTIVE/OPEN rows so existing call sites are unaffected.
   */
  variant?: "live" | "resolved";
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
  variant = "live",
}: LiveMarketRowProps) {
  const traders = upTraderCount + downTraderCount;
  const isResolved = variant === "resolved";
  const winnerLabel =
    market.winner === 1 ? "UP won" : market.winner === 2 ? "DOWN won" : null;
  const settledLabel = market.settlementPrice
    ? formatStrikeUsd(market.settlementPrice)
    : null;

  return (
    <div className="pp-market-row pp-market-row--live">
      <div className="pp-market-row__timer">
        <Clock size={12} />
        <span>{isResolved ? "ENDED" : formatMmSs(countdownSeconds)}</span>
      </div>

      <div>
        <div className="pp-market-row__time">
          {formatTimeRange(market.startTime, market.endTime)}
        </div>
        <div className="pp-market-row__strike">{formatStrike(market.strikePrice)}</div>
      </div>

      <div className="pp-market-row__counters">
        {isResolved ? (
          /* pr-fix-3 Issue 6: resolved-row outcome treatment. Replaces
             the broken "0% up / 0% down" rendering that came from
             reading raw atomic upPrice/downPrice values (always zero for
             markets without recorded trades). Polymarket-parity: winner
             badge in the directional color, settled price callout,
             ENDED time chip. Loser side fades out via the same
             pp-market-row__pct-bar-row container so the existing CSS
             grid keeps the row geometry stable across live vs resolved. */
          <div className="pp-market-row__pct-bar">
            <div className="pp-market-row__pct-bar-row">
              {winnerLabel == null ? (
                <span style={{ color: "var(--fg-2)" }}>—</span>
              ) : market.winner === 1 ? (
                <span className="pp-badge pp-badge--up" style={{ fontWeight: 700 }}>
                  ▲ {winnerLabel}
                </span>
              ) : (
                <span className="pp-badge pp-badge--down" style={{ fontWeight: 700 }}>
                  ▼ {winnerLabel}
                </span>
              )}
              <span
                className="pp-market-row__pct-label pp-tabular"
                style={{ marginTop: 0, color: "var(--fg-1)" }}
              >
                {settledLabel == null ? "Settling…" : `Settled ${settledLabel}`}
              </span>
            </div>
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>

      <div>
        <div className="pp-market-row__pool">{formatPool(market.volume)}</div>
        <div className="pp-market-row__traders">
          {isResolved ? "Resolved" : `${traders} traders`}
        </div>
      </div>
    </div>
  );
}

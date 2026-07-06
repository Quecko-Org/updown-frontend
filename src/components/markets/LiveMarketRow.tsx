import { Clock } from "lucide-react";
import type { MarketListItem } from "@/lib/api";
import { formatStrikeUsd, fmtUsd } from "@/lib/format";

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

function formatStrike(strikePrice: string | undefined, decimals: number | undefined): string {
  const formatted = formatStrikeUsd(strikePrice, decimals);
  return formatted === "Pending" ? "Strike —" : `Strike ${formatted}`;
}

export function LiveMarketRow({
  market,
  countdownSeconds,
  upTraderCount: _upTraderCount,
  downTraderCount: _downTraderCount,
  upPct,
  downPct,
  variant = "live",
}: LiveMarketRowProps) {
  // 2026-05-18: `traders` aggregate was the source of the bottom-right "0
  // traders" text. With the chip + footer changes above, neither
  // upTraderCount nor downTraderCount has a render consumer anymore.
  const isResolved = variant === "resolved";
  const winnerLabel =
    market.winner === 1 ? "UP won" : market.winner === 2 ? "DOWN won" : null;
  const settledLabel = market.settlementPrice
    ? formatStrikeUsd(market.settlementPrice, market.strikeDecimals)
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
        <div className="pp-market-row__strike">{formatStrike(market.strikePrice, market.strikeDecimals)}</div>
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
            {/* 2026-05-18: replaced the hardcoded `upTraderCount` /
                `downTraderCount` zero displays (caller passed literal 0;
                we had no trader-count signal to show). Chip now renders
                the per-side cents value derived from the implied prob —
                Polymarket-parity "UP 51¢" / "49¢ DOWN" style — when the
                book has signal. Pre-trade markets fall back to dashes. */}
            <span className="pp-market-row__count-chip pp-market-row__count-chip--up">
              <span>UP</span>
              <span>{upPct == null ? '—' : `${upPct}¢`}</span>
            </span>

            <div className="pp-market-row__pct-bar">
              {upPct == null || downPct == null ? (
                <div className="pp-market-row__pct-bar-row">
                  <span className="pp-up">—</span>
                  <span className="pp-market-row__pct-label" style={{ marginTop: 0 }}>
                    no quotes yet
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
                  <div className="pp-market-row__pct-label">Implied</div>
                </>
              )}
            </div>

            <span className="pp-market-row__count-chip pp-market-row__count-chip--down">
              <span>{downPct == null ? '—' : `${downPct}¢`}</span>
              <span>DOWN</span>
            </span>
          </>
        )}
      </div>

      <div>
        <div className="pp-market-row__pool">{fmtUsd(market.volume)}</div>
        {/* 2026-05-18: dropped the "{N} traders" line — the underlying
            `traders` was always 0 because the home page hardcoded
            upTraderCount + downTraderCount. We have no trader-count
            signal yet, so show a status word instead. */}
        <div className="pp-market-row__traders">
          {isResolved ? "Resolved" : "Live"}
        </div>
      </div>
    </div>
  );
}

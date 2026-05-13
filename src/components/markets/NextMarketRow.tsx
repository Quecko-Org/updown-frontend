import { ArrowDown, ArrowUp } from "lucide-react";
import type { MarketListItem } from "@/lib/api";

export type NextMarketRowProps = {
  market: MarketListItem;
  upSharePriceCents: number;
  downSharePriceCents: number;
  secondsUntilOpen: number;
  depth: 0 | 1 | 2 | 3;
};

const OPACITY_BY_DEPTH: readonly number[] = [0.72, 0.55, 0.4, 0.28];

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

export function NextMarketRow({
  market,
  upSharePriceCents,
  downSharePriceCents,
  secondsUntilOpen,
  depth,
}: NextMarketRowProps) {
  const opacity = OPACITY_BY_DEPTH[depth] ?? OPACITY_BY_DEPTH[OPACITY_BY_DEPTH.length - 1];
  return (
    <div className="pp-market-row pp-market-row--next" style={{ opacity }}>
      <div>
        <div className="pp-market-row__time">
          {formatTimeRange(market.startTime, market.endTime)}
        </div>
        <div className="pp-market-row__strike">Opens at —</div>
      </div>

      <div>
        <div className="pp-market-row__buy-buttons">
          <button
            type="button"
            className="pp-btn pp-btn--up pp-btn--lg"
            disabled
            aria-disabled="true"
          >
            <ArrowUp size={14} />
            <span>UP</span>
            <span className="pp-market-row__buy-btn-price">{upSharePriceCents}¢</span>
          </button>
          <button
            type="button"
            className="pp-btn pp-btn--down pp-btn--lg"
            disabled
            aria-disabled="true"
          >
            <ArrowDown size={14} />
            <span>DOWN</span>
            <span className="pp-market-row__buy-btn-price">{downSharePriceCents}¢</span>
          </button>
        </div>
      </div>

      <div>
        <div className="pp-market-row__pool">Opens in</div>
        <div className="pp-market-row__traders" style={{ fontFamily: "var(--font-mono)" }}>
          {formatMmSs(secondsUntilOpen)}
        </div>
      </div>
    </div>
  );
}

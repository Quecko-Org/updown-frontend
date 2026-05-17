"use client";

/**
 * Side-by-side ladder (Polymarket-parity layout):
 *   UP bids on the LEFT, DOWN asks on the RIGHT, vertical divider between.
 *   Inside each side, asks render top-down + bids render top-down, with a
 *   thin spread-marker between them. Restyled 2026-05-17 detail-page
 *   redesign — previous single-column unified ladder lives in git history.
 *
 *   Only the directional asks (UP) / bids (DOWN) that PulsePairs treats as
 *   the prediction-market sides are listed; we don't include the
 *   counterparty-leg bids/asks, intentional product UI.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { formatUnits } from "viem";
import { getOrderbook } from "@/lib/api";
import { cn } from "@/lib/cn";
import { wsConnectedAtom, wsLastEventAtAtom } from "@/store/atoms";

const STALE_MS = 30_000;
const USDT_DECIMALS = 6;

function depthNumber(depth: string): number {
  try {
    return Number(formatUnits(BigInt(depth || "0"), USDT_DECIMALS));
  } catch {
    return 0;
  }
}

type Side = "up" | "down";
type Level = { price: number; depth: string; count: number; depthVal: number };

export function OrderBookPanel({
  marketId,
  marketStatus,
}: {
  marketId: string;
  marketStatus?: string;
}) {
  const wsConnected = useAtomValue(wsConnectedAtom);
  const wsLastEventAt = useAtomValue(wsLastEventAtAtom);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const isClosed =
    marketStatus === "RESOLVED" ||
    marketStatus === "CLAIMED" ||
    marketStatus === "TRADING_ENDED";

  const { data, isLoading } = useQuery({
    queryKey: ["orderbook", marketId.toLowerCase()],
    queryFn: () => getOrderbook(marketId),
    refetchInterval: isClosed ? false : 20_000,
    refetchOnWindowFocus: !isClosed,
  });

  const staleHint =
    wsConnected && wsLastEventAt != null && now - wsLastEventAt > STALE_MS
      ? "Live updates paused — falling back to snapshots."
      : !wsConnected
        ? "Live feed disconnected — falling back to snapshots."
        : null;

  const { upLevels, downLevels, maxDepth } = useMemo(() => {
    if (!data) return { upLevels: [] as Level[], downLevels: [] as Level[], maxDepth: 1 };
    // Show up to 8 levels per side — tighter than the old 12 because the
    // side-by-side layout halves the horizontal width per column.
    const ups = data.up.asks.slice(0, 8).map<Level>((l) => ({
      price: l.price,
      depth: l.depth,
      count: l.count,
      depthVal: depthNumber(l.depth),
    }));
    const downs = data.down.asks.slice(0, 8).map<Level>((l) => ({
      price: l.price,
      depth: l.depth,
      count: l.count,
      depthVal: depthNumber(l.depth),
    }));
    const md = Math.max(1, ...ups.map((r) => r.depthVal), ...downs.map((r) => r.depthVal));
    return { upLevels: ups, downLevels: downs, maxDepth: md };
  }, [data]);

  const hasOrders =
    data != null && (data.up.asks.length > 0 || data.down.asks.length > 0);

  if (isLoading || !data) {
    return <div className="pp-book__shell pp-caption">Loading order book…</div>;
  }

  if (isClosed) {
    return (
      <div className="pp-book__shell">
        <p className="pp-caption pp-book__closed">Order book closed — market resolved.</p>
      </div>
    );
  }

  if (!hasOrders) {
    return (
      <div className="pp-book__wrap">
        {staleHint ? <StaleHint text={staleHint} /> : null}
        <div className="pp-book__shell">
          <p className="pp-caption pp-book__closed">—</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pp-book__wrap">
      {staleHint ? <StaleHint text={staleHint} /> : null}
      <div className="pp-book__split">
        <BookColumn side="up" levels={upLevels} maxDepth={maxDepth} />
        <BookColumn side="down" levels={downLevels} maxDepth={maxDepth} />
      </div>
    </div>
  );
}

function BookColumn({
  side,
  levels,
  maxDepth,
}: {
  side: Side;
  levels: Level[];
  maxDepth: number;
}) {
  const label = side === "up" ? "UP" : "DOWN";
  return (
    <div className={cn("pp-book__col", side === "up" ? "pp-book__col--up" : "pp-book__col--down")}>
      <div className="pp-book__col-hd">
        <span className={cn("pp-book__col-side", side === "up" ? "pp-up" : "pp-down")}>{label}</span>
        <span className="pp-micro pp-book__col-price">Price</span>
        <span className="pp-micro pp-book__col-depth">Depth</span>
      </div>
      {levels.length === 0 ? (
        <div className="pp-book__col-empty pp-caption">no orders</div>
      ) : (
        levels.map((l, i) => (
          <BookRow key={`${side}-${i}`} side={side} level={l} maxDepth={maxDepth} />
        ))
      )}
    </div>
  );
}

function StaleHint({ text }: { text: string }) {
  return <p className="pp-book__stale-hint">{text}</p>;
}

function BookRow({
  side,
  level,
  maxDepth,
}: {
  side: Side;
  level: Level;
  maxDepth: number;
}) {
  const pct = maxDepth > 0 ? Math.min(100, (level.depthVal / maxDepth) * 100) : 0;
  return (
    <div className={cn("pp-book__col-row", side === "up" ? "pp-book__col-row--up" : "pp-book__col-row--down")}>
      <div
        className={cn("pp-book__col-bar", side === "up" ? "pp-book__col-bar--up" : "pp-book__col-bar--down")}
        style={{ width: `${pct}%` }}
      />
      <span className="pp-book__col-price-val pp-tabular">{(level.price / 100).toFixed(0)}¢</span>
      <span className="pp-book__col-depth-val pp-tabular">${level.depth}</span>
    </div>
  );
}

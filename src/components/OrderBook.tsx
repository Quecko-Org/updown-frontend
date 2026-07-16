"use client";

/**
 * Side-by-side ladder (Polymarket-parity layout):
 *   UP column on the LEFT, DOWN column on the RIGHT, vertical divider
 *   between. Inside each column the BID levels (current buy demand for
 *   that outcome) render best-first; ASK levels (sell offers) render
 *   below once anyone holds shares to sell.
 *
 * 2026-05-18 fix: the prior implementation read `data.up.asks` /
 * `data.down.asks` exclusively, so any market whose liquidity was
 * entirely on the BID side (the DMM bot's cold-start state — naked SELL
 * legs revert until inventory accumulates) rendered as empty. Now reads
 * BOTH sides per outcome; once asks land they join the same column.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { formatUnits } from "viem";
import { getOrderbook } from "@/lib/api";
import { unifyOrderBook } from "@/lib/unifiedBook";
import { COMPLEMENTARY_MATCHING_ENABLED } from "@/config/environment";
import { cn } from "@/lib/cn";
import { focusedMarketKeyAtom, wsConnectedAtom, wsLastEventAtAtom } from "@/store/atoms";
import { useWsLive } from "@/hooks/useWsLive";

const STALE_MS = 30_000;
const USDT_DECIMALS = 6;

/**
 * Buyable / sellable DOLLAR value at a price level = shares × price.
 * `depth` is a SHARE count in atomic USDT (6-dp); `priceBps` is 1..9999.
 * Rendering raw shares as "$" badly overstates thin books — 25 shares at an
 * 8.5¢ ask is $2.13 of liquidity, not "$25.00" — and made the trade form's
 * honest "insufficient depth" look like a bug. This is the cash a taker can
 * actually deploy against the level, matching `walkBookForBudget`.
 */
function depthUsd(depth: string, priceBps: number): number {
  try {
    const shares = BigInt(depth || "0");
    const notionalAtomic = (shares * BigInt(Math.round(priceBps))) / BigInt(10000);
    return Number(formatUnits(notionalAtomic, USDT_DECIMALS));
  } catch {
    return 0;
  }
}

type Side = "up" | "down";
type Level = { price: number; depth: string; count: number; depthVal: number; kind: 'bid' | 'ask' };

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

  // The `orderbook:<key>` WS channel pushes full snapshots into this exact
  // cache for the focused market, so drop the 20s poll while the socket is
  // live and this is the focused book; fall back to polling otherwise (WS
  // down, or a non-focused market). Window-focus + reconnect refetch still
  // re-seed after any gap.
  const focusedKey = useAtomValue(focusedMarketKeyAtom);
  const wsLive = useWsLive();
  const wsBacked =
    wsLive && !!focusedKey && marketId.toLowerCase() === focusedKey.toLowerCase();

  const { data, isLoading } = useQuery({
    queryKey: ["orderbook", marketId.toLowerCase()],
    queryFn: () => getOrderbook(marketId),
    refetchInterval: isClosed || wsBacked ? false : 20_000,
    refetchOnWindowFocus: !isClosed,
  });

  const staleHint =
    wsConnected && wsLastEventAt != null && now - wsLastEventAt > STALE_MS
      ? "Live updates paused — falling back to snapshots."
      : !wsConnected
        ? "Live feed disconnected — falling back to snapshots."
        : null;

  // Complementary matching: fold each option's book into a single deep view (a DOWN
  // bid shows as a synthetic UP ask, etc.) so a cold-start book with only buy-side
  // demand renders fillable liquidity. Off → the raw {up,down} book, unchanged.
  const view = useMemo(
    () => (data ? unifyOrderBook(data, COMPLEMENTARY_MATCHING_ENABLED) : data),
    [data],
  );

  const { upLevels, downLevels, maxDepth } = useMemo(() => {
    if (!view) return { upLevels: [] as Level[], downLevels: [] as Level[], maxDepth: 1 };
    // Merge bids + asks per outcome into a single price-sorted ladder.
    // Both blocks render price-DESCENDING, so the spread sits in the
    // middle: best ask (lowest sell) at the BOTTOM of the ask block,
    // best bid (highest buy) at the TOP of the bid block, the two facing
    // each other. Tag each level with `kind` so the renderer can
    // color-code bid (green) vs ask (red).
    const toLevels = (
      bids: { price: number; depth: string; count: number }[],
      asks: { price: number; depth: string; count: number }[],
    ): Level[] => {
      const bidLevels = [...bids]
        .sort((a, b) => b.price - a.price)
        .slice(0, 8)
        .map<Level>((l) => ({
          price: l.price,
          depth: l.depth,
          count: l.count,
          depthVal: depthUsd(l.depth, l.price),
          kind: 'bid',
        }));
      // Sort ASCENDING to `slice` the 8 *best* (lowest) asks, then reverse
      // for display. Sorting descending up front would keep the 8 worst.
      const askLevels = [...asks]
        .sort((a, b) => a.price - b.price)
        .slice(0, 8)
        .map<Level>((l) => ({
          price: l.price,
          depth: l.depth,
          count: l.count,
          depthVal: depthUsd(l.depth, l.price),
          kind: 'ask',
        }))
        .reverse();
      // Asks on top (best/lowest sell last, nearest the spread), then bids
      // (best/highest buy first) — standard CLOB layout.
      return [...askLevels, ...bidLevels];
    };
    const ups = toLevels(view.up.bids, view.up.asks);
    const downs = toLevels(view.down.bids, view.down.asks);
    const md = Math.max(1, ...ups.map((r) => r.depthVal), ...downs.map((r) => r.depthVal));
    return { upLevels: ups, downLevels: downs, maxDepth: md };
  }, [view]);

  const hasOrders =
    data != null &&
    (data.up.bids.length + data.up.asks.length + data.down.bids.length + data.down.asks.length > 0);

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
  // `depthVal` is the buyable/sellable DOLLAR value at this level
  // (shares × price via `depthUsd`), not the raw share count — so a thin
  // book at a skewed price reads honestly (e.g. $2.13, not "$25.00").
  const depthLabel = level.depthVal.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    <div className={cn("pp-book__col-row", side === "up" ? "pp-book__col-row--up" : "pp-book__col-row--down")}>
      <div
        className={cn("pp-book__col-bar", side === "up" ? "pp-book__col-bar--up" : "pp-book__col-bar--down")}
        style={{ width: `${pct}%` }}
      />
      <span className="pp-book__col-price-val pp-tabular">
        {level.kind === 'ask' ? '↑ ' : ''}{Math.round(level.price / 100)}¢
      </span>
      <span className="pp-book__col-depth-val pp-tabular">${depthLabel}</span>
    </div>
  );
}

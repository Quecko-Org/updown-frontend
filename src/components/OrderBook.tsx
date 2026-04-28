"use client";

/**
 * Unified ladder (product layout): UP asks on top, spread divider, DOWN bids below.
 * Does not list UP bids or DOWN asks — intentional UI, not full book depth.
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

type Row =
  | { kind: "up-ask"; price: number; depth: string; count: number; depthVal: number }
  | { kind: "down-bid"; price: number; depth: string; count: number; depthVal: number };

export function OrderBookPanel({
  marketId,
  marketStatus,
}: {
  marketId: string;
  /** Optional. When the market is terminal, the book is dimmed + labelled
   *  closed so a stale snapshot can't be misread as live depth. */
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

  const { upRows, downRows, maxDepth, spreadCents } = useMemo(() => {
    if (!data) return { upRows: [], downRows: [], maxDepth: 1, spreadCents: null as number | null };
    const upAsks = [...data.up.asks].reverse().slice(0, 12);
    const downBids = data.down.bids.slice(0, 12);
    const uRows: Array<Row & { kind: "up-ask" }> = upAsks.map((l) => ({
      kind: "up-ask",
      price: l.price,
      depth: l.depth,
      count: l.count,
      depthVal: depthNumber(l.depth),
    }));
    const dRows: Array<Row & { kind: "down-bid" }> = downBids.map((l) => ({
      kind: "down-bid",
      price: l.price,
      depth: l.depth,
      count: l.count,
      depthVal: depthNumber(l.depth),
    }));
    const md = Math.max(1, ...uRows.map((r) => r.depthVal), ...dRows.map((r) => r.depthVal));
    const bestUpAsk = uRows[uRows.length - 1]?.price;
    const bestDownBid = dRows[0]?.price;
    const spread =
      bestUpAsk != null && bestDownBid != null ? Math.max(0, Math.round((bestUpAsk - bestDownBid) / 100)) : null;
    return { upRows: uRows, downRows: dRows, maxDepth: md, spreadCents: spread };
  }, [data]);

  const hasOrders = data != null && (data.up.asks.length > 0 || data.down.bids.length > 0);

  if (isLoading || !data) {
    return <div className="pp-panel pp-caption text-center">Loading order book…</div>;
  }

  if (isClosed) {
    return (
      <div className="pp-panel">
        <p className="pp-caption text-center" style={{ color: "var(--fg-2)" }}>
          Order book closed — market resolved.
        </p>
      </div>
    );
  }

  if (!hasOrders) {
    return (
      <div className="space-y-2">
        {staleHint ? <StaleHint text={staleHint} /> : null}
        <div className="pp-panel">
          <p className="pp-caption text-center">—</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {staleHint ? <StaleHint text={staleHint} /> : null}
      <div className="pp-panel" style={{ padding: 0 }}>
        <div className="pp-book">
          <div className="pp-book__hd">
            <span className="pp-micro">Side</span>
            <span className="pp-micro">Price</span>
            <span className="pp-micro" style={{ textAlign: "right" }}>
              Depth
            </span>
            <span className="pp-micro" style={{ textAlign: "right" }}>
              Orders
            </span>
          </div>

          {upRows.map((r, i) => (
            <BookRow key={`u-${i}`} row={r} maxDepth={maxDepth} />
          ))}

          <div className="pp-book__spread">
            <span className="pp-micro">
              Spread {spreadCents != null ? `· ${spreadCents}¢` : ""}
            </span>
          </div>

          {downRows.map((r, i) => (
            <BookRow key={`d-${i}`} row={r} maxDepth={maxDepth} />
          ))}
        </div>
      </div>
    </div>
  );
}

function StaleHint({ text }: { text: string }) {
  return (
    <p
      className="pp-caption rounded-[4px] border px-2 py-1"
      style={{
        background: "var(--warn-bg)",
        borderColor: "oklch(80% 0.15 85 / 0.4)",
        color: "var(--warn)",
      }}
    >
      {text}
    </p>
  );
}

function BookRow({ row, maxDepth }: { row: Row; maxDepth: number }) {
  const pct = maxDepth > 0 ? Math.min(100, (row.depthVal / maxDepth) * 100) : 0;
  const isUp = row.kind === "up-ask";
  return (
    <div className="pp-book__row">
      <div
        className="pp-book__bar"
        style={{
          width: `${pct}%`,
          background: isUp ? "var(--up)" : "var(--down)",
        }}
      />
      <span className={cn("pp-book__side", isUp ? "pp-up" : "pp-down")}>
        {isUp ? "UP" : "DOWN"}
      </span>
      <span className="pp-tabular">{(row.price / 100).toFixed(2)}¢</span>
      <span className="pp-tabular" style={{ textAlign: "right" }}>
        ${row.depth}
      </span>
      <span className="pp-tabular" style={{ textAlign: "right" }}>
        {row.count}
      </span>
    </div>
  );
}

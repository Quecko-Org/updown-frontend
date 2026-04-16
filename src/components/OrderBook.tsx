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

export function OrderBookPanel({ marketId }: { marketId: string }) {
  const wsConnected = useAtomValue(wsConnectedAtom);
  const wsLastEventAt = useAtomValue(wsLastEventAtAtom);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["orderbook", marketId.toLowerCase()],
    queryFn: () => getOrderbook(marketId),
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });

  const staleHint =
    wsConnected && wsLastEventAt != null && now - wsLastEventAt > STALE_MS
      ? "Live updates paused — refreshing via REST."
      : !wsConnected
        ? "WS disconnected — REST snapshots."
        : null;

  const { rows, maxDepth } = useMemo(() => {
    if (!data) return { rows: [] as Row[], maxDepth: 0 };
    const upAsks = [...data.up.asks].reverse().slice(0, 12);
    const downBids = data.down.bids.slice(0, 12);
    const r: Row[] = [
      ...upAsks.map((l) => ({
        kind: "up-ask" as const,
        price: l.price,
        depth: l.depth,
        count: l.count,
        depthVal: depthNumber(l.depth),
      })),
      ...downBids.map((l) => ({
        kind: "down-bid" as const,
        price: l.price,
        depth: l.depth,
        count: l.count,
        depthVal: depthNumber(l.depth),
      })),
    ];
    const maxDepth = r.reduce((m, x) => Math.max(m, x.depthVal), 0) || 1;
    return { rows: r, maxDepth };
  }, [data]);

  const hasOrders = data != null && (data.up.asks.length > 0 || data.down.bids.length > 0);

  if (isLoading || !data) {
    return (
      <div className="panel-dense py-8 text-center text-xs text-muted">Loading order book…</div>
    );
  }

  if (!hasOrders) {
    return (
      <div className="space-y-2">
        {staleHint ? (
          <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-950">{staleHint}</p>
        ) : null}
        <div className="panel-dense flex min-h-[120px] items-center justify-center py-8">
          <p className="max-w-sm text-center text-xs text-muted">
            No orders yet — be the first to provide liquidity
          </p>
        </div>
      </div>
    );
  }

  const upRows = rows.filter((x): x is Row & { kind: "up-ask" } => x.kind === "up-ask");
  const downRows = rows.filter((x): x is Row & { kind: "down-bid" } => x.kind === "down-bid");

  return (
    <div className="space-y-2">
      {staleHint ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-950">{staleHint}</p>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-border bg-white">
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-border bg-surface-muted font-semibold uppercase tracking-wide text-muted">
              <th className="w-8 px-1 py-1" aria-hidden />
              <th className="px-2 py-1">Side</th>
              <th className="px-2 py-1">Price</th>
              <th className="px-2 py-1 text-right">Depth</th>
              <th className="px-2 py-1 text-right">Orders</th>
            </tr>
          </thead>
          <tbody className="font-mono text-neutral-ink">
            {upRows.map((l, i) => (
              <BookRow key={`u-${i}`} row={l} maxDepth={maxDepth} />
            ))}
            <tr>
              <td colSpan={5} className="bg-surface-muted py-1.5 text-center text-[9px] font-bold uppercase tracking-widest text-muted">
                Spread
              </td>
            </tr>
            {downRows.map((l, i) => (
              <BookRow key={`d-${i}`} row={l} maxDepth={maxDepth} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BookRow({ row, maxDepth }: { row: Row; maxDepth: number }) {
  const pct = maxDepth > 0 ? Math.min(100, (row.depthVal / maxDepth) * 100) : 0;
  const isUp = row.kind === "up-ask";
  return (
    <tr className={cn("border-b border-border/50", isUp ? "bg-success-soft/35" : "bg-down-soft/40")}>
      <td className="w-16 px-1 py-0.5 align-middle">
        <div className="h-1 w-full overflow-hidden rounded bg-white/80">
          <div
            className={cn("h-full rounded-sm", isUp ? "bg-success" : "bg-down")}
            style={{ width: `${pct}%` }}
          />
        </div>
      </td>
      <td className="px-2 py-0.5 font-semibold">{isUp ? "UP" : "DOWN"}</td>
      <td className="px-2 py-0.5">{(row.price / 100).toFixed(2)}¢</td>
      <td className="px-2 py-0.5 text-right">{row.depth}</td>
      <td className="px-2 py-0.5 text-right">{row.count}</td>
    </tr>
  );
}

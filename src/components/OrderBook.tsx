"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { getOrderbook, type OrderBookResponse } from "@/lib/api";
import { cn } from "@/lib/cn";
import { wsConnectedAtom, wsLastEventAtAtom } from "@/store/atoms";

const STALE_MS = 30_000;

function SideTable({
  title,
  snapshot,
  accent,
}: {
  title: string;
  snapshot: OrderBookResponse["up"];
  accent: "up" | "down";
}) {
  const rows = [...snapshot.asks].reverse().slice(0, 8);
  const bids = snapshot.bids.slice(0, 8);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white shadow-card">
      <div
        className={cn(
          "border-b border-border px-4 py-3",
          accent === "up" ? "bg-success-soft" : "bg-down-soft"
        )}
      >
        <p
          className={cn(
            "text-sm font-bold",
            accent === "up" ? "text-success-dark" : "text-down"
          )}
        >
          {title}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-muted font-semibold uppercase tracking-wide text-muted">
              <th className="px-4 py-2 font-semibold">Price</th>
              <th className="px-4 py-2 text-right font-semibold">Depth</th>
              <th className="px-4 py-2 text-right font-semibold">Orders</th>
            </tr>
          </thead>
          <tbody className="font-mono text-neutral-ink">
            {rows.map((l, i) => (
              <tr key={`a-${i}`} className="border-b border-border/60 bg-white">
                <td className="px-4 py-1.5">{(l.price / 100).toFixed(2)}¢</td>
                <td className="px-4 py-1.5 text-right">{l.depth}</td>
                <td className="px-4 py-1.5 text-right">{l.count}</td>
              </tr>
            ))}
            <tr>
              <td
                colSpan={3}
                className="bg-surface-muted py-2 text-center text-[10px] font-bold uppercase tracking-widest text-muted"
              >
                Spread
              </td>
            </tr>
            {bids.map((l, i) => (
              <tr
                key={`b-${i}`}
                className={cn(
                  "border-b border-border/60",
                  accent === "up" ? "bg-success-soft/30" : "bg-down-soft"
                )}
              >
                <td className="px-4 py-1.5 font-medium text-foreground">
                  {(l.price / 100).toFixed(2)}¢
                </td>
                <td className="px-4 py-1.5 text-right text-foreground">{l.depth}</td>
                <td className="px-4 py-1.5 text-right text-foreground">{l.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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
      ? "No live book updates for a while — data may lag; reconnecting in the background."
      : !wsConnected
        ? "WebSocket disconnected — showing periodic REST snapshots."
        : null;

  if (isLoading || !data) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface-muted/50 py-12 text-center text-sm text-muted">
        Loading order book…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {staleHint ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          {staleHint}
        </p>
      ) : null}
      <div className="grid gap-5 md:grid-cols-2">
        <SideTable title="UP · Option 1" snapshot={data.up} accent="up" />
        <SideTable title="DOWN · Option 2" snapshot={data.down} accent="down" />
      </div>
    </div>
  );
}

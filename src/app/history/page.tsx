"use client";

import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useAccount } from "wagmi";
import Link from "next/link";
import { getMarket, getOrders, getTrades, type TradeRow } from "@/lib/api";
import { formatUsdt } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/cn";
import { marketPathFromAddress } from "@/lib/marketKey";
import { sessionReadyAtom, userSmartAccount } from "@/store/atoms";

const PAGE = 20;

function tradeResult(t: TradeRow, winner: number | null | undefined, wallet: string): string {
  if (winner == null || winner === 0) return "—";
  const w = wallet.toLowerCase();
  const wonOpt = t.option === winner;
  if (t.buyer.toLowerCase() === w) {
    return wonOpt ? "Win (buy)" : "Lose (buy)";
  }
  if (t.seller.toLowerCase() === w) {
    return wonOpt ? "Lose (sell)" : "Win (sell)";
  }
  return "—";
}

export default function HistoryPage() {
  const { address, isConnected } = useAccount();
  const smartAccount = useAtomValue(userSmartAccount);
  const sessionReady = useAtomValue(sessionReadyAtom);
  const [offset, setOffset] = useState(0);

  const { data: trades, isLoading } = useQuery({
    queryKey: ["trades", smartAccount?.toLowerCase() ?? "", offset],
    queryFn: () => getTrades(smartAccount!, PAGE, offset),
    enabled: !!smartAccount && isConnected && sessionReady,
    retry: 1,
  });

  // Fix D: "My orders" lives on the same ["orders", <eoa>] queryKey that
  // TradeForm.onSuccess invalidates, so placing an order refreshes this list
  // in <500ms. Backend stores orders keyed by EOA (`maker`), not the smart
  // account, so pass the EOA here — same convention as postOrder/cancelOrder.
  const addrLower = address?.toLowerCase() ?? "";
  const { data: ordersResp } = useQuery({
    queryKey: ["orders", addrLower],
    queryFn: () => getOrders(address!, { limit: 50 }),
    enabled: !!address && isConnected,
    retry: 1,
    // Short staleTime — WS order_update keeps us mostly in sync, but the
    // refetch picks up anything the socket missed.
    staleTime: 10_000,
  });
  const orders = ordersResp?.orders ?? [];

  const markets = useMemo(() => {
    const s = new Set<string>();
    trades?.forEach((t) => s.add(t.market.toLowerCase()));
    return Array.from(s);
  }, [trades]);

  const marketQueries = useQueries({
    queries: markets.map((m) => ({
      queryKey: ["market", m],
      queryFn: () => getMarket(m),
      enabled: !!trades?.length,
      staleTime: 60_000,
    })),
  });

  const winnerByMarket = useMemo(() => {
    const map = new Map<string, number | null>();
    markets.forEach((m, i) => {
      const d = marketQueries[i]?.data;
      map.set(m, d?.winner ?? null);
    });
    return map;
  }, [markets, marketQueries]);

  if (!isConnected) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center">
        <EmptyState
          icon="wallet"
          title="Connect your wallet"
          subtitle="Your filled trades will appear here once you connect and trade."
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">History</h1>

      {/* Fix D: My orders — surfaced above Trades so a freshly-placed LIMIT
          appears immediately via TradeForm.onSuccess cache invalidation. */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold tracking-tight text-foreground">My orders</h2>
        {orders.length === 0 ? (
          <EmptyState
            icon="list"
            title="No orders yet"
            subtitle="Orders you've placed appear here with their live status. Cancelled and filled are kept for your records."
          />
        ) : (
          <div className="card-kraken overflow-hidden overflow-x-auto p-0">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-muted text-xs font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">Market</th>
                  <th className="px-4 py-3">Dir</th>
                  <th className="px-4 py-3">Side</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="hidden px-4 py-3 sm:table-cell">Price</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="hidden px-4 py-3 md:table-cell">Placed</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr
                    key={o.orderId}
                    className="border-b border-border/80 last:border-0 odd:bg-white even:bg-surface-muted/40"
                  >
                    <td className="px-4 py-3">
                      <Link href={marketPathFromAddress(o.market)} className="font-medium text-brand hover:underline">
                        {o.market.length > 20 ? `${o.market.slice(0, 10)}…` : o.market}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "rounded-md px-2 py-0.5 text-xs font-bold",
                          o.option === 1 ? "bg-success-soft text-success-dark" : "bg-down-soft text-down",
                        )}
                      >
                        {o.option === 1 ? "UP" : "DOWN"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold text-foreground">
                      {o.side === 0 ? "BUY" : "SELL"}
                    </td>
                    <td className="px-4 py-3 font-mono text-foreground">{formatUsdt(o.amount)}</td>
                    <td className="hidden px-4 py-3 font-medium text-foreground sm:table-cell">
                      {o.type === 1 ? "MKT" : `${(o.price / 100).toFixed(0)}¢`}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "rounded-md px-2 py-0.5 text-xs font-bold",
                          o.status === "FILLED" && "bg-success-soft text-success-dark",
                          o.status === "CANCELLED" && "bg-surface-muted text-muted",
                          o.status === "OPEN" && "bg-brand-subtle text-brand",
                          o.status === "PARTIALLY_FILLED" && "bg-brand-subtle text-brand",
                        )}
                      >
                        {o.status}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 text-muted md:table-cell">
                      {new Date(o.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <h2 className="text-lg font-bold tracking-tight text-foreground">Trades</h2>
      {isLoading && (
        <div className="py-12 text-center text-sm text-muted">Loading history…</div>
      )}
      {!isLoading && (!trades || trades.length === 0) && (
        <EmptyState
          icon="list"
          title="No trades yet"
          subtitle="Executed trades will show in this table with direction, size, and outcome hints after markets resolve."
        />
      )}
      <div className="card-kraken overflow-hidden overflow-x-auto p-0">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border bg-surface-muted text-xs font-semibold uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Market</th>
              <th className="px-4 py-3">Dir</th>
              <th className="px-4 py-3">Amount</th>
              <th className="hidden px-4 py-3 sm:table-cell">Price</th>
              <th className="hidden px-4 py-3 md:table-cell">Time</th>
              <th className="px-4 py-3">Result</th>
            </tr>
          </thead>
          <tbody>
            {trades?.map((t) => (
              <tr
                key={t.tradeId}
                className="border-b border-border/80 last:border-0 odd:bg-white even:bg-surface-muted/40"
              >
                <td className="px-4 py-3">
                  <Link href={marketPathFromAddress(t.market)} className="font-medium text-brand hover:underline">
                    {t.market.length > 20 ? `${t.market.slice(0, 10)}…` : t.market}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      "rounded-md px-2 py-0.5 text-xs font-bold",
                      t.option === 1 ? "bg-success-soft text-success-dark" : "bg-down-soft text-down"
                    )}
                  >
                    {t.option === 1 ? "UP" : "DOWN"}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-foreground">{formatUsdt(t.amount)}</td>
                <td className="hidden px-4 py-3 font-medium text-foreground sm:table-cell">{(t.price / 100).toFixed(2)}¢</td>
                <td className="hidden px-4 py-3 text-muted md:table-cell">
                  {new Date(t.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-sm text-foreground">
                  {smartAccount
                    ? tradeResult(t, winnerByMarket.get(t.market.toLowerCase()), smartAccount)
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="rounded-[12px] border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
          disabled={offset === 0}
          onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
        >
          Previous
        </button>
        <button
          type="button"
          className="rounded-[12px] border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!trades || trades.length < PAGE}
          onClick={() => setOffset((o) => o + PAGE)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

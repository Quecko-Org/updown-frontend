"use client";

import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useAccount } from "wagmi";
import Link from "next/link";
import { getMarket, getOrders, getTrades, type TradeRow } from "@/lib/api";
import { formatUsdt } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { CancelOrderButton } from "@/components/CancelOrderButton";
import { cn } from "@/lib/cn";
import { marketPathFromAddress } from "@/lib/marketKey";
import { sessionReadyAtom, userSmartAccount } from "@/store/atoms";

const PAGE = 20;

function shortenMarket(addr: string): string {
  if (addr.length <= 20) return addr;
  return `${addr.slice(0, 10)}…${addr.slice(-6)}`;
}

function tradeResult(t: TradeRow, winner: number | null | undefined, wallet: string): string {
  if (winner == null || winner === 0) return "—";
  const w = wallet.toLowerCase();
  const wonOpt = t.option === winner;
  if (t.buyer.toLowerCase() === w) return wonOpt ? "Win (buy)" : "Lose (buy)";
  if (t.seller.toLowerCase() === w) return wonOpt ? "Lose (sell)" : "Win (sell)";
  return "—";
}

function statusChipClass(status: string): string {
  if (status === "FILLED") return "pp-chip-status pp-chip-status--filled";
  if (status === "CANCELLED") return "pp-chip-status pp-chip-status--cancelled";
  if (status === "OPEN") return "pp-chip-status pp-chip-status--open";
  if (status === "PARTIALLY_FILLED") return "pp-chip-status pp-chip-status--partial";
  return "pp-chip-status pp-chip-status--open";
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

  // "My orders" shares ["orders", <eoa>] with TradeForm.onSuccess for <500ms
  // refresh after a place. Backend keys by EOA (not smart account).
  const addrLower = address?.toLowerCase() ?? "";
  const { data: ordersResp } = useQuery({
    queryKey: ["orders", addrLower],
    queryFn: () => getOrders(address!, { limit: 50 }),
    enabled: !!address && isConnected,
    retry: 1,
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="pp-h1">History</h1>
        <p className="pp-caption mt-1">Open orders, cancelled orders, and filled trades.</p>
      </div>

      {!isConnected && (
        <EmptyState
          icon="wallet"
          title="Connect your wallet"
          subtitle="Orders and filled trades show here once connected."
        />
      )}

      {isConnected && (
        <>
      {/* Open + recent orders — surfaced above Trades so a freshly-placed LIMIT
          appears immediately via TradeForm.onSuccess cache invalidation. */}
      <section className="space-y-3">
        <h2 className="pp-h3">My orders</h2>
        {orders.length === 0 ? (
          <EmptyState
            icon="list"
            title="No orders yet"
            subtitle="Orders show here. Cancelled and filled stay for your records."
          />
        ) : (
          <div
            className="overflow-hidden overflow-x-auto rounded-[6px] border"
            style={{ borderColor: "var(--border-0)", background: "var(--bg-1)" }}
          >
            <table className="pp-table min-w-full">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Dir</th>
                  <th>Side</th>
                  <th className="r">Amount</th>
                  <th className="r hidden sm:table-cell">Price</th>
                  <th>Status</th>
                  <th className="hidden md:table-cell">Placed</th>
                  <th className="r">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.orderId}>
                    <td>
                      <Link
                        href={marketPathFromAddress(o.market)}
                        className="hover:underline"
                        style={{ color: "var(--fg-0)" }}
                      >
                        <span className="pp-hash">{shortenMarket(o.market)}</span>
                      </Link>
                    </td>
                    <td>
                      <span className={o.option === 1 ? "pp-chip-up" : "pp-chip-down"}>
                        {o.option === 1 ? "UP" : "DOWN"}
                      </span>
                    </td>
                    <td>
                      <span className="pp-micro" style={{ color: "var(--fg-0)" }}>
                        {o.side === 0 ? "BUY" : "SELL"}
                      </span>
                    </td>
                    <td className="r pp-tabular" style={{ color: "var(--fg-0)" }}>
                      ${formatUsdt(o.amount)}
                    </td>
                    <td className="r pp-tabular hidden sm:table-cell" style={{ color: "var(--fg-0)" }}>
                      {o.type === 1 ? "MKT" : `${(o.price / 100).toFixed(0)}¢`}
                    </td>
                    <td>
                      <span className={statusChipClass(o.status)}>{o.status}</span>
                    </td>
                    <td className="pp-hash hidden md:table-cell" style={{ color: "var(--fg-2)" }}>
                      {new Date(o.createdAt).toLocaleString()}
                    </td>
                    <td className="r">
                      {o.status === "OPEN" || o.status === "PARTIALLY_FILLED" ? (
                        <CancelOrderButton orderId={o.orderId} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="pp-h3">Trades</h2>
        {isLoading && <div className="py-8 text-center pp-caption">Loading history…</div>}
        {!isLoading && (!trades || trades.length === 0) && (
          <EmptyState
            icon="list"
            title="No trades yet"
            subtitle="Executed trades show here with direction, size, and outcome after markets resolve."
          />
        )}
        {!!trades?.length && (
          <div
            className="overflow-hidden overflow-x-auto rounded-[6px] border"
            style={{ borderColor: "var(--border-0)", background: "var(--bg-1)" }}
          >
            <table className="pp-table min-w-full">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Dir</th>
                  <th className="r">Amount</th>
                  <th className="r hidden sm:table-cell">Price</th>
                  <th className="hidden md:table-cell">Time</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.tradeId}>
                    <td>
                      <Link
                        href={marketPathFromAddress(t.market)}
                        className="hover:underline"
                        style={{ color: "var(--fg-0)" }}
                      >
                        <span className="pp-hash">{shortenMarket(t.market)}</span>
                      </Link>
                    </td>
                    <td>
                      <span className={t.option === 1 ? "pp-chip-up" : "pp-chip-down"}>
                        {t.option === 1 ? "UP" : "DOWN"}
                      </span>
                    </td>
                    <td className="r pp-tabular" style={{ color: "var(--fg-0)" }}>
                      ${formatUsdt(t.amount)}
                    </td>
                    <td className="r pp-tabular hidden sm:table-cell" style={{ color: "var(--fg-0)" }}>
                      {(t.price / 100).toFixed(2)}¢
                    </td>
                    <td className="pp-hash hidden md:table-cell" style={{ color: "var(--fg-2)" }}>
                      {new Date(t.createdAt).toLocaleString()}
                    </td>
                    <td style={{ color: "var(--fg-0)" }}>
                      {smartAccount
                        ? tradeResult(t, winnerByMarket.get(t.market.toLowerCase()), smartAccount)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cn("pp-btn pp-btn--secondary pp-btn--sm")}
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
          >
            Previous
          </button>
          <button
            type="button"
            className={cn("pp-btn pp-btn--secondary pp-btn--sm")}
            disabled={!trades || trades.length < PAGE}
            onClick={() => setOffset((o) => o + PAGE)}
          >
            Next
          </button>
        </div>
      </section>
        </>
      )}
    </div>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { getOrders, type OrderRow, type PositionRow } from "@/lib/api";
import { formatUsdt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/EmptyState";
import { CancelOrderButton } from "@/components/CancelOrderButton";
import { WalletConnectorList } from "@/components/WalletConnectorList";

/**
 * Phase2-A: combines what used to be MyOrdersOnMarket + the inline "Your
 * positions" table on the market detail page into a single panel with two
 * sub-sections. Reduces split-rendering inconsistency by giving the user one
 * place to look for "everything I have on this market".
 *
 * Visibility rules:
 *   - Wallet disconnected → prompt to connect
 *   - Connected, no orders + no positions → empty state
 *   - Otherwise → render whichever subsection has rows
 */
export function YourActivityOnMarket({
  marketComposite,
  smartAccount,
  positions,
}: {
  marketComposite: string;
  smartAccount: string | null | undefined;
  positions: PositionRow[];
}) {
  const { address, isConnected } = useAccount();
  const addrLower = address?.toLowerCase() ?? "";
  const mKey = marketComposite.toLowerCase();

  const { data: ordersResp } = useQuery({
    queryKey: ["orders", addrLower],
    queryFn: () => getOrders(address!, { status: ["OPEN", "PARTIALLY_FILLED"], limit: 50 }),
    enabled: !!address && isConnected,
    staleTime: 5_000,
    retry: 1,
  });
  const openOrders: OrderRow[] = (ordersResp?.orders ?? []).filter(
    (o) => o.market.toLowerCase() === mKey,
  );

  if (!isConnected || !smartAccount) {
    return (
      <section className="mt-6">
        <h2 className="pp-h2">Your activity in this market</h2>
        <EmptyState
          icon="wallet"
          title="Connect wallet"
          subtitle="Connect a wallet to see your orders and positions for this market."
          className="min-h-0 py-6 mt-3"
        >
          <WalletConnectorList className="w-full max-w-xs" />
        </EmptyState>
      </section>
    );
  }

  if (openOrders.length === 0 && positions.length === 0) {
    return (
      <section className="mt-6">
        <h2 className="pp-h2">Your activity in this market</h2>
        <EmptyState
          icon="trade"
          title="Nothing yet"
          subtitle="Your open orders and filled positions for this market show here."
          className="min-h-0 py-6 mt-3"
        />
      </section>
    );
  }

  return (
    <section className="mt-6 space-y-5">
      <h2 className="pp-h2">Your activity in this market</h2>

      {openOrders.length > 0 ? (
        <div className="space-y-2">
          <h3 className="pp-h3">Open orders</h3>
          <OrdersSubtable rows={openOrders} />
        </div>
      ) : null}

      {positions.length > 0 ? (
        <div className="space-y-2">
          <h3 className="pp-h3">Filled positions</h3>
          <PositionsSubtable rows={positions} />
        </div>
      ) : null}
    </section>
  );
}

function OrdersSubtable({ rows }: { rows: OrderRow[] }) {
  return (
    <div
      className="overflow-hidden overflow-x-auto rounded-[6px] border"
      style={{ borderColor: "var(--border-0)", background: "var(--bg-1)" }}
    >
      <table className="pp-table min-w-full">
        <thead>
          <tr>
            <th>Dir</th>
            <th>Side</th>
            <th className="r">Price</th>
            <th className="r">Amount</th>
            <th className="r">Filled</th>
            <th>Status</th>
            <th className="r">&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.orderId}>
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
                {o.type === 1 ? "MKT" : `${(o.price / 100).toFixed(0)}¢`}
              </td>
              <td className="r pp-tabular" style={{ color: "var(--fg-0)" }}>
                ${formatUsdt(o.amount)}
              </td>
              <td className="r pp-tabular" style={{ color: "var(--fg-2)" }}>
                ${formatUsdt(o.filledAmount)}
              </td>
              <td>
                <span
                  className={cn(
                    "pp-chip-status",
                    o.status === "OPEN" && "pp-chip-status--open",
                    o.status === "PARTIALLY_FILLED" && "pp-chip-status--partial",
                  )}
                >
                  {o.status === "PARTIALLY_FILLED" ? "PARTIAL" : o.status}
                </span>
              </td>
              <td className="r">
                <CancelOrderButton orderId={o.orderId} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PositionsSubtable({ rows }: { rows: PositionRow[] }) {
  return (
    <div
      className="overflow-hidden overflow-x-auto rounded-[6px] border"
      style={{ borderColor: "var(--border-0)", background: "var(--bg-1)" }}
    >
      <table className="pp-table min-w-full">
        <thead>
          <tr>
            <th>Side</th>
            <th className="r">Shares</th>
            <th className="r">Avg price</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={`${p.market}-${p.option}`}>
              <td>
                <span className={cn(p.option === 1 ? "pp-chip-up" : "pp-chip-down")}>
                  {p.optionLabel}
                </span>
              </td>
              <td className="r pp-tabular" style={{ color: "var(--fg-0)" }}>
                ${formatUsdt(p.shares)}
              </td>
              <td className="r pp-tabular" style={{ color: "var(--fg-2)" }}>
                {p.avgPrice} bps
              </td>
              <td>
                <span className="pp-chip pp-chip--cd">
                  <span className="pp-tabular">
                    {p.marketStatus === "CLAIMED" ? "RESOLVED" : p.marketStatus}
                  </span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

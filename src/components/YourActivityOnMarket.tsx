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
 * sub-sections. 2026-05-17 detail-page redesign: layout migrated from
 * raw Tailwind to the `pp-your-activity*` token block in pp-utilities.css.
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
  marketWindowLabel,
  marketStatus,
}: {
  marketComposite: string;
  smartAccount: string | null | undefined;
  positions: PositionRow[];
  marketWindowLabel?: string | null;
  marketStatus?: string | null;
}) {
  const { isConnected } = useAccount();
  const addrLower = smartAccount?.toLowerCase() ?? "";
  const mKey = marketComposite.toLowerCase();

  // 2026-05-17: previously filtered to OPEN/PARTIALLY_FILLED only, which
  // meant a wallet whose orders had all been cancelled (USER_CANCEL,
  // EXPIRED, MARKET_ENDED) saw an empty "your activity" panel even when
  // it should clearly show the recent attempts. Drop the status filter,
  // sort newest first, surface the canonical recent activity for this
  // market with status badges. Cancel action gated on OPEN/PARTIAL only.
  const { data: ordersResp } = useQuery({
    queryKey: ["orders", addrLower],
    queryFn: () => getOrders(smartAccount!, { limit: 50 }),
    enabled: !!smartAccount && isConnected,
    staleTime: 5_000,
    retry: 1,
  });
  const recentOrders: OrderRow[] = (ordersResp?.orders ?? [])
    .filter((o) => o.market.toLowerCase() === mKey)
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
    .slice(0, 20);
  const hasOpenOrders = recentOrders.some(
    (o) => o.status === "OPEN" || o.status === "PARTIALLY_FILLED",
  );

  if (!isConnected || !smartAccount) {
    return (
      <section className="pp-your-activity">
        <h2 className="pp-your-activity__title">Your activity in this market</h2>
        <EmptyState
          icon="wallet"
          title="Connect wallet"
          subtitle="Connect a wallet to see your orders and positions for this market."
          className="pp-your-activity__empty"
        >
          <WalletConnectorList className="pp-your-activity__connect-list" />
        </EmptyState>
      </section>
    );
  }

  if (recentOrders.length === 0 && positions.length === 0) {
    return (
      <section className="pp-your-activity">
        <h2 className="pp-your-activity__title">Your activity in this market</h2>
        <EmptyState
          icon="trade"
          title="Nothing yet"
          subtitle="Your open orders and filled positions for this market show here."
          className="pp-your-activity__empty"
        />
      </section>
    );
  }

  return (
    <section className="pp-your-activity">
      <h2 className="pp-your-activity__title">Your activity in this market</h2>

      {recentOrders.length > 0 ? (
        <div className="pp-your-activity__section">
          <h3 className="pp-your-activity__section-title">
            {hasOpenOrders ? "Orders" : "Recent orders"}
          </h3>
          <OrdersSubtable rows={recentOrders} marketStatus={marketStatus ?? null} />
        </div>
      ) : null}

      {positions.length > 0 ? (
        <div className="pp-your-activity__section">
          <div className="pp-your-activity__section-head">
            <h3 className="pp-your-activity__section-title">Filled positions</h3>
            {marketWindowLabel ? (
              <span className="pp-your-activity__window-label pp-tabular">
                {marketWindowLabel}
              </span>
            ) : null}
          </div>
          <PositionsSubtable rows={positions} />
        </div>
      ) : null}
    </section>
  );
}

function OrdersSubtable({
  rows,
  marketStatus,
}: {
  rows: OrderRow[];
  marketStatus: string | null;
}) {
  return (
    <div className="pp-your-activity__table-wrap">
      <table className="pp-table pp-your-activity__table">
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
                <span className="pp-your-activity__cell-strong">
                  {o.side === 0 ? "BUY" : "SELL"}
                </span>
              </td>
              <td className="r pp-tabular pp-your-activity__cell-strong">
                {o.type === 1 ? "MKT" : `${(o.price / 100).toFixed(0)}¢`}
              </td>
              <td className="r pp-tabular pp-your-activity__cell-strong">
                ${formatUsdt(o.amount)}
              </td>
              <td className="r pp-tabular pp-your-activity__cell-muted">
                ${formatUsdt(o.filledAmount)}
              </td>
              <td>
                <span
                  className={cn(
                    "pp-chip-status",
                    o.status === "OPEN" && "pp-chip-status--open",
                    o.status === "PARTIALLY_FILLED" && "pp-chip-status--partial",
                    o.status === "FILLED" && "pp-chip-status--filled",
                    o.status === "CANCELLED" && "pp-chip-status--cancelled",
                  )}
                  title={o.status === "CANCELLED" && o.reason ? `Reason: ${o.reason}` : undefined}
                >
                  {o.status === "PARTIALLY_FILLED"
                    ? "PARTIAL"
                    : o.status === "CANCELLED" && o.reason === "EXPIRED"
                      ? "EXPIRED"
                      : o.status === "CANCELLED" && o.reason === "MARKET_ENDED"
                        ? "MARKET ENDED"
                        : o.status}
                </span>
              </td>
              <td className="r">
                {marketStatus === "ACTIVE" && (o.status === "OPEN" || o.status === "PARTIALLY_FILLED") ? (
                  <CancelOrderButton orderId={o.orderId} />
                ) : null}
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
    <div className="pp-your-activity__table-wrap">
      <table className="pp-table pp-your-activity__table">
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
              <td className="r pp-tabular pp-your-activity__cell-strong">
                ${formatUsdt(p.shares)}
              </td>
              <td className="r pp-tabular pp-your-activity__cell-muted">
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

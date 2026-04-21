"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { getOrders, type OrderRow } from "@/lib/api";
import { formatUsdt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CancelOrderButton } from "./CancelOrderButton";

/**
 * Shows the connected wallet's OPEN / PARTIALLY_FILLED orders on the current
 * market. Fills the visibility gap in the unified OrderBook ladder (which
 * intentionally hides UP bids + DOWN asks — so a resting BUY UP would otherwise
 * be invisible to the user who placed it). Query key `["orders", <eoa>]` is
 * shared with the History page so TradeForm.onSuccess / CancelOrderButton
 * invalidations refresh both views.
 */
export function MyOrdersOnMarket({ marketComposite }: { marketComposite: string }) {
  const { address, isConnected } = useAccount();
  const addrLower = address?.toLowerCase() ?? "";

  const { data: ordersResp } = useQuery({
    queryKey: ["orders", addrLower],
    queryFn: () => getOrders(address!, { status: ["OPEN", "PARTIALLY_FILLED"], limit: 50 }),
    enabled: !!address && isConnected,
    staleTime: 5_000,
    retry: 1,
  });

  const mKey = marketComposite.toLowerCase();
  const rows: OrderRow[] = (ordersResp?.orders ?? []).filter(
    (o) => o.market.toLowerCase() === mKey,
  );

  if (!isConnected || rows.length === 0) return null;

  return (
    <div className="pp-panel mt-3">
      <span className="pp-micro">Your orders on this market</span>
      <div className="mt-2 overflow-x-auto">
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
    </div>
  );
}

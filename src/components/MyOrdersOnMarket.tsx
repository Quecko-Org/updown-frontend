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
 * be invisible to the user who placed it). Each row has an inline Cancel
 * button that signs + submits DELETE /orders/:id.
 *
 * Query key `["orders", <eoa>]` is shared with the History page so
 * TradeForm.onSuccess / CancelOrderButton.onSuccess invalidations refresh both
 * views without duplicate fetches.
 */
export function MyOrdersOnMarket({ marketComposite }: { marketComposite: string }) {
  const { address, isConnected } = useAccount();
  const addrLower = address?.toLowerCase() ?? "";

  const { data: ordersResp } = useQuery({
    queryKey: ["orders", addrLower],
    queryFn: () =>
      getOrders(address!, { status: ["OPEN", "PARTIALLY_FILLED"], limit: 50 }),
    enabled: !!address && isConnected,
    staleTime: 5_000,
    retry: 1,
  });

  // Server already accepts `?market=` but filtering client-side keeps this
  // component responsive to concurrent orders placed on other markets in the
  // same session without a re-fetch. The list is capped at 50 by the API.
  const mKey = marketComposite.toLowerCase();
  const rows: OrderRow[] = (ordersResp?.orders ?? []).filter(
    (o) => o.market.toLowerCase() === mKey,
  );

  if (!isConnected || rows.length === 0) return null;

  return (
    <div className="panel-dense mt-3 px-3 py-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted">
        Your orders on this market
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            <tr>
              <th className="py-1 pr-3">Dir</th>
              <th className="py-1 pr-3">Side</th>
              <th className="py-1 pr-3">Price</th>
              <th className="py-1 pr-3">Amount</th>
              <th className="py-1 pr-3">Filled</th>
              <th className="py-1 pr-3">Status</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr
                key={o.orderId}
                className="border-t border-border/80 font-medium text-foreground"
              >
                <td className="py-1.5 pr-3">
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-[10px] font-bold",
                      o.option === 1
                        ? "bg-success-soft text-success-dark"
                        : "bg-down-soft text-down",
                    )}
                  >
                    {o.option === 1 ? "UP" : "DOWN"}
                  </span>
                </td>
                <td className="py-1.5 pr-3 font-semibold">
                  {o.side === 0 ? "BUY" : "SELL"}
                </td>
                <td className="py-1.5 pr-3 font-mono tabular-nums">
                  {o.type === 1 ? "MKT" : `${(o.price / 100).toFixed(0)}¢`}
                </td>
                <td className="py-1.5 pr-3 font-mono tabular-nums">
                  ${formatUsdt(o.amount)}
                </td>
                <td className="py-1.5 pr-3 font-mono tabular-nums text-muted">
                  ${formatUsdt(o.filledAmount)}
                </td>
                <td className="py-1.5 pr-3">
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-[10px] font-bold",
                      o.status === "OPEN" && "bg-brand-subtle text-brand",
                      o.status === "PARTIALLY_FILLED" && "bg-brand-subtle text-brand",
                    )}
                  >
                    {o.status === "PARTIALLY_FILLED" ? "PARTIAL" : o.status}
                  </span>
                </td>
                <td className="py-1.5">
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

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useAccount } from "wagmi";
import Link from "next/link";
import { toast } from "sonner";
import { getPositions, postMarketClaim } from "@/lib/api";
import { formatUsdt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/EmptyState";
import { marketPathFromAddress } from "@/lib/marketKey";
import { userSmartAccount } from "@/store/atoms";

function shortenMarket(addr: string): string {
  if (addr.length <= 22) return addr;
  return `${addr.slice(0, 12)}…${addr.slice(-8)}`;
}

export default function PositionsPage() {
  const { isConnected, address: walletAddress } = useAccount();
  const smartAccount = useAtomValue(userSmartAccount);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["positions", smartAccount?.toLowerCase() ?? ""],
    queryFn: () => getPositions(smartAccount!),
    enabled: !!smartAccount && isConnected,
    refetchInterval: 20_000,
    retry: 1,
  });

  const claim = useMutation({
    mutationFn: (market: string) => postMarketClaim(market),
    onSuccess: () => {
      toast.success("Claim submitted");
      const sa = smartAccount?.toLowerCase() ?? "";
      qc.invalidateQueries({ queryKey: ["positions", sa] });
      qc.invalidateQueries({ queryKey: ["balance", walletAddress?.toLowerCase() ?? ""] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="pp-h1">Positions</h1>
        <p className="pp-caption mt-1">Open exposure per market. Winnings credit via the relayer.</p>
      </div>

      {!isConnected && (
        <EmptyState
          icon="wallet"
          title="Connect your wallet"
          subtitle="Connect a wallet to view open positions and claim resolved markets."
        />
      )}

      {isConnected && isLoading && (
        <div className="py-8 text-center pp-caption">Loading positions…</div>
      )}

      {isConnected && !isLoading && !data?.length && (
        <EmptyState
          icon="trade"
          title="No open positions"
          subtitle="Buy UP or DOWN on a market. Exposure shows here."
        />
      )}

      {!!data?.length && (
        <div
          className="overflow-hidden overflow-x-auto rounded-[6px] border"
          style={{ borderColor: "var(--border-0)", background: "var(--bg-1)" }}
        >
          <table className="pp-table min-w-full">
            <thead>
              <tr>
                <th>Market</th>
                <th>Side</th>
                <th>Status</th>
                <th className="r">Shares</th>
                <th className="r">Avg price</th>
                <th className="r">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={`${p.market}-${p.option}`}>
                  <td>
                    <Link
                      href={marketPathFromAddress(p.market)}
                      className="hover:underline"
                      style={{ color: "var(--fg-0)" }}
                    >
                      <span className="pp-hash">{shortenMarket(p.market)}</span>
                    </Link>
                  </td>
                  <td>
                    <span className={cn(p.option === 1 ? "pp-chip-up" : "pp-chip-down")}>
                      {p.optionLabel}
                    </span>
                  </td>
                  <td>
                    {/* Market-level chip always reads RESOLVED for closed markets;
                        the per-position "Auto-claimed" chip in the action column
                        tells the user whether their winnings already landed. */}
                    <span
                      className={cn(
                        "pp-chip-status",
                        p.marketStatus === "ACTIVE" && "pp-chip-status--open",
                        (p.marketStatus === "RESOLVED" || p.marketStatus === "CLAIMED") &&
                          "pp-chip-status--open",
                        p.marketStatus !== "ACTIVE" &&
                          p.marketStatus !== "RESOLVED" &&
                          p.marketStatus !== "CLAIMED" &&
                          "pp-chip-status--cancelled",
                      )}
                    >
                      {p.marketStatus === "CLAIMED" ? "RESOLVED" : p.marketStatus}
                    </span>
                  </td>
                  <td className="r pp-tabular" style={{ color: "var(--fg-0)" }}>
                    ${formatUsdt(p.shares)}
                  </td>
                  <td className="r pp-tabular" style={{ color: "var(--fg-2)" }}>
                    {p.avgPrice} bps
                  </td>
                  <td className="r">
                    {/*
                     * CLAIMED = relayer auto-claimed. Show confirmation chip.
                     * RESOLVED (not yet CLAIMED) = keep manual "Claim" as relayer-failure fallback.
                     */}
                    {p.marketStatus === "CLAIMED" && (
                      <span className="pp-chip-status pp-chip-status--filled">Auto-claimed</span>
                    )}
                    {p.marketStatus === "RESOLVED" && (
                      <button
                        type="button"
                        className="pp-btn pp-btn--secondary pp-btn--sm"
                        disabled={claim.isPending}
                        onClick={() => claim.mutate(p.market)}
                        title="Nudge the relayer to credit winnings for this market."
                      >
                        Claim
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="pp-caption">
        Winnings credit via the relayer after resolution. Claim nudges the backend for resolved markets.
      </p>
    </div>
  );
}

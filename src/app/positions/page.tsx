"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import Link from "next/link";
import { toast } from "sonner";
import { getPositions, postMarketClaim } from "@/lib/api";
import { formatUsdt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/EmptyState";

export default function PositionsPage() {
  const { address, isConnected } = useAccount();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["positions", address?.toLowerCase() ?? ""],
    queryFn: () => getPositions(address!),
    enabled: !!address && isConnected,
    refetchInterval: 20_000,
  });

  const claim = useMutation({
    mutationFn: (market: string) => postMarketClaim(market),
    onSuccess: () => {
      toast.success("Claim request sent");
      qc.invalidateQueries({ queryKey: ["positions", address?.toLowerCase()] });
      qc.invalidateQueries({ queryKey: ["balance", address?.toLowerCase()] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isConnected) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center">
        <EmptyState
          icon="wallet"
          title="Connect your wallet"
          subtitle="Connect with the button in the header to view your open positions and claim resolved markets."
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted">Loading positions…</div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">Positions</h1>
      {!data?.length && (
        <EmptyState
          icon="trade"
          title="No open positions"
          subtitle="When you buy UP or DOWN on a market, your exposure will show here. Browse markets from the home page to get started."
        />
      )}
      <ul className="space-y-4">
        {data?.map((p) => (
          <li
            key={`${p.market}-${p.option}`}
            className={cn(
              "card-kraken flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between",
              p.option === 1 && "border-l-4 border-l-success",
              p.option === 2 && "border-l-4 border-l-down"
            )}
          >
            <div>
              <Link href={`/market/${p.market}`} className="font-display text-lg font-bold text-brand hover:underline">
                {p.market.slice(0, 10)}…{p.market.slice(-6)}
              </Link>
              <p className="mt-1 text-sm text-muted">
                <span
                  className={cn(
                    "mr-2 font-semibold",
                    p.option === 1 ? "text-success-dark" : "text-down"
                  )}
                >
                  {p.optionLabel}
                </span>
                · {p.marketStatus}
              </p>
              <p className="mt-2 text-sm text-foreground">
                Shares{" "}
                <span className="font-mono font-semibold">{formatUsdt(p.shares)}</span>
                <span className="text-muted"> · Avg {p.avgPrice} bps</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(p.marketStatus === "RESOLVED" || p.marketStatus === "CLAIMED") && (
                <button
                  type="button"
                  className="btn-primary !text-sm"
                  disabled={claim.isPending}
                  onClick={() => claim.mutate(p.market)}
                >
                  Claim / sync
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs leading-relaxed text-muted">
        Winnings are credited by the relayer after resolution. Claim nudges the backend relayer path for
        resolved markets.
      </p>
    </div>
  );
}

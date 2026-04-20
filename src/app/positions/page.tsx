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
import { sessionReadyAtom, userSmartAccount } from "@/store/atoms";

export default function PositionsPage() {
  const { isConnected, address: walletAddress } = useAccount();
  const smartAccount = useAtomValue(userSmartAccount);
  const sessionReady = useAtomValue(sessionReadyAtom);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["positions", smartAccount?.toLowerCase() ?? ""],
    queryFn: () => getPositions(smartAccount!),
    enabled: !!smartAccount && isConnected && sessionReady,
    refetchInterval: 20_000,
    retry: 1,
  });

  const claim = useMutation({
    mutationFn: (market: string) => postMarketClaim(market),
    onSuccess: () => {
      toast.success("Claim request sent");
      const sa = smartAccount?.toLowerCase() ?? "";
      qc.invalidateQueries({ queryKey: ["positions", sa] });
      qc.invalidateQueries({ queryKey: ["balance", walletAddress?.toLowerCase() ?? ""] });
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
              <Link href={marketPathFromAddress(p.market)} className="font-display text-lg font-bold text-brand hover:underline">
                {p.market.length > 22
                  ? `${p.market.slice(0, 12)}…${p.market.slice(-10)}`
                  : p.market}
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
            <div className="flex flex-wrap items-center gap-2">
              {/*
               * CLAIMED = relayer auto-claimed (status flips to CLAIMED together
               * with claimedByRelayer=true in ClaimService). Show a confirmation
               * badge — no button, nothing to do.
               * RESOLVED (without CLAIMED yet) = settlement winner known but the
               * relayer path hasn't credited yet — keep a manual nudge button
               * as the fallback for relayer-failure cases.
               */}
              {p.marketStatus === "CLAIMED" && (
                <span className="rounded-[12px] border border-success/30 bg-success/10 px-3 py-1.5 text-sm font-semibold text-success">
                  Auto-claimed ✓
                </span>
              )}
              {p.marketStatus === "RESOLVED" && (
                <button
                  type="button"
                  className="btn-primary !text-sm"
                  disabled={claim.isPending}
                  onClick={() => claim.mutate(p.market)}
                  title="Nudge the relayer to credit winnings for this market."
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

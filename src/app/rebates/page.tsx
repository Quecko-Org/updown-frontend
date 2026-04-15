"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { getDmmRebates, postDmmClaimRebate } from "@/lib/api";
import { formatUsdt } from "@/lib/format";
import { formatUserFacingError } from "@/lib/errors";
import { EmptyState } from "@/components/EmptyState";

function formatAtomicUsdtSafe(raw: string | undefined): string {
  if (raw == null || raw === "") return "0.00";
  try {
    return formatUsdt(raw);
  } catch {
    return raw;
  }
}

export default function RebatesPage() {
  const { address, isConnected } = useAccount();
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dmmRebates", address?.toLowerCase() ?? ""],
    queryFn: () => getDmmRebates(address!),
    enabled: !!address && isConnected,
  });

  const claim = useMutation({
    mutationFn: () => postDmmClaimRebate({ wallet: address! }),
    onSuccess: () => {
      toast.success("Claim submitted");
      void qc.invalidateQueries({ queryKey: ["dmmRebates", address?.toLowerCase()] });
      void qc.invalidateQueries({ queryKey: ["balance", address?.toLowerCase()] });
    },
    onError: (e: Error) => toast.error(formatUserFacingError(e)),
  });

  if (!isConnected) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center">
        <EmptyState
          icon="wallet"
          title="Connect your wallet"
          subtitle="Connect with the button in the header to view DMM rebates and claim history."
        />
      </div>
    );
  }

  const accumulated =
    (typeof data?.accumulatedRebate === "string" && data.accumulatedRebate) ||
    (typeof data?.pendingRebate === "string" && data.pendingRebate) ||
    "0";
  const totalClaimed = typeof data?.totalClaimed === "string" ? data.totalClaimed : undefined;
  const history = Array.isArray(data?.claimHistory) ? data!.claimHistory! : [];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">Rebates</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Accumulated maker rebates for your wallet. Claim sends an on-chain or relayer settlement per API behavior.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary shrink-0"
          disabled={claim.isPending || isLoading || isError}
          onClick={() => claim.mutate()}
        >
          {claim.isPending ? "Claiming…" : "Claim"}
        </button>
      </div>

      {isLoading && (
        <div className="py-12 text-center text-sm text-muted">Loading rebates…</div>
      )}
      {isError && (
        <EmptyState
          icon="list"
          title="Could not load rebates"
          subtitle="The rebates API may be unavailable or your wallet may not be enrolled in the DMM program."
        />
      )}
      {!isLoading && !isError && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="card-kraken p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Accumulated</p>
              <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-foreground">
                ${formatAtomicUsdtSafe(accumulated)}
              </p>
              <p className="mt-1 text-xs text-muted">USDT (raw from API)</p>
            </div>
            {totalClaimed != null && (
              <div className="card-kraken p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Total claimed</p>
                <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-brand">
                  ${formatAtomicUsdtSafe(totalClaimed)}
                </p>
              </div>
            )}
          </div>

          <section className="space-y-3">
            <h2 className="font-display border-b border-border pb-2 text-lg font-bold text-foreground">
              Claim history
            </h2>
            {history.length === 0 ? (
              <p className="text-sm text-muted">No claim records returned yet.</p>
            ) : (
              <ul className="space-y-2">
                {history.map((row, i) => (
                  <li
                    key={`${row.claimedAt ?? i}-${row.txHash ?? ""}`}
                    className="card-kraken flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                  >
                    <span className="font-mono text-foreground">
                      {row.amount != null ? `$${formatAtomicUsdtSafe(row.amount)}` : "—"}
                    </span>
                    <span className="text-muted">{row.claimedAt ?? "—"}</span>
                    {row.txHash ? (
                      <span className="font-mono text-xs text-brand">{row.txHash.slice(0, 10)}…</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <p className="text-sm text-muted">
        <Link href="/fees" className="font-semibold text-brand hover:underline">
          Fee structure →
        </Link>
      </p>
    </div>
  );
}

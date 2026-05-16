"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useAtomValue } from "jotai";
import { toast } from "sonner";
import { getDmmRebates, postDmmClaimRebate } from "@/lib/api";
import { formatUsdt } from "@/lib/format";
import { formatUserFacingError } from "@/lib/errors";
import { EmptyState } from "@/components/EmptyState";
import { userSmartAccount } from "@/store/atoms";

function formatAtomicUsdtSafe(raw: string | undefined): string {
  if (raw == null || raw === "") return "0.00";
  try {
    return formatUsdt(raw);
  } catch {
    return raw;
  }
}

export default function RebatesPage() {
  const { isConnected } = useAccount();
  // Phase 4 PR-A (2026-05-16): rebates accrue to order.maker = TW (traced
  // via DMMService.scheduleRebateFromFill → maker). Querying by EOA returns
  // 0 always. Read the TW from the shared atom; Path-1 fallback (no factory)
  // → atom is set to EOA, so this still resolves.
  const smartAccount = useAtomValue(userSmartAccount);
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dmmRebates", smartAccount?.toLowerCase() ?? ""],
    queryFn: () => getDmmRebates(smartAccount!),
    enabled: !!smartAccount && isConnected,
  });

  const claim = useMutation({
    mutationFn: () => postDmmClaimRebate({ wallet: smartAccount! }),
    onSuccess: () => {
      toast.success("Claim submitted");
      void qc.invalidateQueries({ queryKey: ["dmmRebates", smartAccount?.toLowerCase()] });
      const ti = smartAccount?.toLowerCase() ?? "";
      if (ti) void qc.invalidateQueries({ queryKey: ["balance", ti] });
    },
    onError: (e: Error) => toast.error(formatUserFacingError(e)),
  });

  if (!isConnected) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center">
        <EmptyState
          icon="wallet"
          title="Connect your wallet"
          subtitle="Connect a wallet to view rebates and claim history."
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
          <h1 className="pp-h1">Rebates</h1>
          <p className="pp-caption mt-1 max-w-xl">
            Accumulated maker rebates. Claim settles on-chain or via the relayer.
          </p>
        </div>
        <button
          type="button"
          className="pp-btn pp-btn--primary pp-btn--md shrink-0"
          disabled={claim.isPending || isLoading || isError}
          onClick={() => claim.mutate()}
        >
          {claim.isPending ? "Claiming…" : "Claim"}
        </button>
      </div>

      {isLoading && <div className="py-8 text-center pp-caption">Loading rebates…</div>}
      {isError && (
        <EmptyState
          icon="list"
          title="Could not load rebates"
          subtitle="The rebates API may be unavailable, or this wallet is not enrolled in the DMM program."
        />
      )}

      {!isLoading && !isError && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="pp-panel">
              <p className="pp-micro">Accumulated</p>
              <p className="pp-price-xl mt-2">${formatAtomicUsdtSafe(accumulated)}</p>
              <p className="pp-hash mt-1" style={{ color: "var(--fg-2)" }}>
                USDT
              </p>
            </div>
            {totalClaimed != null && (
              <div className="pp-panel">
                <p className="pp-micro">Total claimed</p>
                <p className="pp-price-xl mt-2">${formatAtomicUsdtSafe(totalClaimed)}</p>
              </div>
            )}
          </div>

          <section className="space-y-3">
            <h2 className="pp-h2">Claim history</h2>
            {history.length === 0 ? (
              <p className="pp-caption">No claims yet.</p>
            ) : (
              <div
                className="overflow-hidden overflow-x-auto rounded-[var(--r-lg)] border"
                style={{ borderColor: "var(--border-0)", background: "var(--bg-1)" }}
              >
                <table className="pp-table min-w-full">
                  <thead>
                    <tr>
                      <th className="r">Amount</th>
                      <th>Claimed at</th>
                      <th>Tx</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row, i) => (
                      <tr key={`${row.claimedAt ?? i}-${row.txHash ?? ""}`}>
                        <td className="r pp-tabular" style={{ color: "var(--fg-0)" }}>
                          {row.amount != null ? `$${formatAtomicUsdtSafe(row.amount)}` : "—"}
                        </td>
                        <td className="pp-hash" style={{ color: "var(--fg-2)" }}>
                          {row.claimedAt ?? "—"}
                        </td>
                        <td className="pp-hash" style={{ color: "var(--fg-0)" }}>
                          {row.txHash ? `${row.txHash.slice(0, 10)}…` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <p className="pp-caption">
        <Link href="/fees" className="hover:underline" style={{ color: "var(--fg-0)" }}>
          Fee structure →
        </Link>
      </p>
    </div>
  );
}

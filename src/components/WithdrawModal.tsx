"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignTypedData } from "wagmi";
import { toast } from "sonner";
import { getBalance, getConfig, postWithdraw } from "@/lib/api";
import { buildWithdrawTypedData } from "@/lib/eip712";
import { parseUsdtToAtomic } from "@/lib/format";
import { cn } from "@/lib/cn";
import { formatUserFacingError } from "@/lib/errors";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function WithdrawModal({ open, onClose }: Props) {
  const { address, isConnected } = useAccount();
  const [amountStr, setAmountStr] = useState("");
  const qc = useQueryClient();
  const { signTypedDataAsync } = useSignTypedData();

  const { data: cfg } = useQuery({
    queryKey: ["apiConfig"],
    queryFn: getConfig,
    staleTime: 300_000,
    enabled: open,
  });

  const { data: bal } = useQuery({
    queryKey: ["balance", address?.toLowerCase() ?? ""],
    queryFn: () => getBalance(address!),
    enabled: open && !!address && isConnected,
  });

  const withdraw = useMutation({
    mutationFn: async () => {
      if (!address || !cfg || !bal) throw new Error("Missing data");
      const amount = parseUsdtToAtomic(amountStr);
      if (amount <= BigInt(0)) throw new Error("Invalid amount");
      const typed = buildWithdrawTypedData(
        cfg,
        address as `0x${string}`,
        amount,
        BigInt(bal.withdrawNonce)
      );
      const signature = await signTypedDataAsync(typed);
      await postWithdraw({
        wallet: address,
        amount: amount.toString(),
        signature,
      });
    },
    onSuccess: () => {
      toast.success("Withdrawal submitted");
      qc.invalidateQueries({ queryKey: ["balance", address?.toLowerCase()] });
      onClose();
    },
    onError: (e: Error) => toast.error(formatUserFacingError(e)),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-overlay" aria-label="Close" onClick={onClose} />
      <div className={cn("card-kraken relative z-10 w-full max-w-md p-6 shadow-card-hover")}>
        <h2 className="font-display text-xl font-bold text-foreground">Withdraw USDT</h2>
        <p className="mt-2 text-sm text-muted">Sign the withdrawal message; the relayer sends USDT on-chain.</p>
        <label className="mt-4 block text-xs font-medium text-muted">Amount (USDT)</label>
        <input
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          placeholder="0.00"
          className="mt-1 w-full rounded-[12px] border border-border bg-white px-3 py-2.5 text-foreground transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
        {bal && (
          <p className="mt-2 text-xs text-muted">
            Available: <span className="font-mono text-foreground">{bal.available}</span> (atomic)
          </p>
        )}
        <button
          type="button"
          disabled={withdraw.isPending || !isConnected}
          className="btn-primary mt-6 w-full disabled:opacity-50"
          onClick={() => withdraw.mutate()}
        >
          {withdraw.isPending ? "Signing…" : "Withdraw"}
        </button>
        <button type="button" className="btn-secondary mt-3 w-full" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

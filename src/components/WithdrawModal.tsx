"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { formatUserFacingError } from "@/lib/errors";
import { getFormattedAddress } from "@/utils/walletHelpers";
import { useWalletContext } from "@/context/WalletContext";
import { useGetUsdtBalance } from "@/hooks/useBalance";
import { useWithdraw } from "@/hooks/useWithdraw";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function WithdrawModal({ open, onClose }: Props) {
  const { isWalletConnected, walletAddress, smartAccountAddress } = useWalletContext();
  const [amountStr, setAmountStr] = useState("");
  const qc = useQueryClient();
  const { balance } = useGetUsdtBalance();
  const { withdraw } = useWithdraw();

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      if (!walletAddress) throw new Error("No destination wallet");
      if (!smartAccountAddress) throw new Error("Smart account not ready");
      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid amount");
      if (amount > balance) throw new Error("Amount exceeds available balance");

      const result = await withdraw(walletAddress, amount, balance);
      if (result.error) throw result.error;
      return result.txHash;
    },
    onSuccess: (txHash) => {
      toast.success(txHash ? `Withdrawal sent · ${txHash.slice(0, 10)}…` : "Withdrawal sent");
      qc.invalidateQueries({ queryKey: ["balance", smartAccountAddress?.toLowerCase()] });
      setAmountStr("");
      onClose();
    },
    onError: (e: Error) => toast.error(formatUserFacingError(e)),
  });

  const setMax = () => setAmountStr(balance.toFixed(6));

  if (!open) return null;

  const canSubmit =
    isWalletConnected &&
    !!walletAddress &&
    !!smartAccountAddress &&
    !withdrawMutation.isPending &&
    Number(amountStr) > 0 &&
    Number(amountStr) <= balance;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-overlay"
        aria-label="Close"
        onClick={onClose}
      />
      <div className={cn("card-kraken relative z-10 w-full max-w-md p-6 shadow-card-hover")}>
        <h2 className="font-display text-xl font-bold text-foreground">Withdraw USDT</h2>
        <p className="mt-2 text-sm text-muted">
          Sends USDT from your smart account to your connected wallet on Arbitrum. Signed by your
          session key via the smart account.
        </p>

        {/* From / To summary */}
        <div className="mt-4 space-y-2 rounded-[12px] border border-border bg-surface-muted/40 px-3 py-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold uppercase tracking-wide text-muted">From (smart account)</span>
            <span className="font-mono text-foreground">
              {smartAccountAddress ? getFormattedAddress(smartAccountAddress) : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-semibold uppercase tracking-wide text-muted">To (your wallet)</span>
            <span className="font-mono text-foreground">
              {walletAddress ? getFormattedAddress(walletAddress) : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-semibold uppercase tracking-wide text-muted">Available</span>
            <span className="font-mono font-bold tabular-nums text-foreground">
              ${balance.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
        </div>

        <label className="mt-4 block text-xs font-medium text-muted">Amount (USDT)</label>
        <div className="relative mt-1">
          <input
            value={amountStr}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "" || /^\d*\.?\d*$/.test(v)) setAmountStr(v);
            }}
            placeholder="0.00"
            inputMode="decimal"
            className="w-full rounded-[12px] border border-border bg-white px-3 py-2.5 pr-16 text-foreground transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            disabled={withdrawMutation.isPending}
          />
          <button
            type="button"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-[8px] bg-brand-subtle px-2 py-1 text-xs font-semibold text-brand hover:bg-brand hover:text-white disabled:opacity-50"
            onClick={setMax}
            disabled={withdrawMutation.isPending || balance <= 0}
          >
            MAX
          </button>
        </div>

        <button
          type="button"
          disabled={!canSubmit}
          className="btn-primary mt-6 w-full disabled:opacity-50"
          onClick={() => withdrawMutation.mutate()}
        >
          {withdrawMutation.isPending ? "Withdrawing…" : "Withdraw"}
        </button>
        <button
          type="button"
          className="btn-secondary mt-3 w-full"
          onClick={onClose}
          disabled={withdrawMutation.isPending}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

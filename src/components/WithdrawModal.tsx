"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useAtomValue } from "jotai";
import { encodeFunctionData, erc20Abi, parseUnits, type Address, type Hex } from "viem";
import { toast } from "sonner";
import { getBalance, getConfig } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatUserFacingError } from "@/lib/errors";
import { userSmartAccount, userSmartAccountClient, apiConfigAtom, sessionReadyAtom } from "@/store/atoms";
import { PAYMASTER_POLICY_ID } from "@/config/environment";

type Props = {
  open: boolean;
  onClose: () => void;
};

/** Minimal typing for AA client: sendCalls signs with the WalletClientSigner (EOA) passed to createSmartWalletClient — not the scoped session key. See @account-kit/wallet-client `sendCalls.d.ts`. */
type WithdrawSmartWalletClient = {
  sendCalls: (params: {
    calls: readonly { to: Address; data?: Hex; value?: Hex }[];
    from: Address;
    capabilities: { paymasterService: { policyId: string } };
  }) => Promise<{ id: string }>;
  waitForCallsStatus: (params: { id: string }) => Promise<{
    receipts?: ReadonlyArray<{ transactionHash?: Hex }>;
    status?: string;
  }>;
};

export function WithdrawModal({ open, onClose }: Props) {
  const { address, isConnected } = useAccount();
  const [amountStr, setAmountStr] = useState("");
  const qc = useQueryClient();
  const smartAccountClient = useAtomValue(userSmartAccountClient);
  const smartAccount = useAtomValue(userSmartAccount);
  const apiConfig = useAtomValue(apiConfigAtom);
  const sessionReady = useAtomValue(sessionReadyAtom);

  const { data: cfg } = useQuery({
    queryKey: ["apiConfig"],
    queryFn: getConfig,
    staleTime: 300_000,
    enabled: open,
  });

  const usdtAddress = (apiConfig ?? cfg)?.usdtAddress as Address | undefined;

  const { data: bal } = useQuery({
    queryKey: ["balance", smartAccount?.toLowerCase() ?? ""],
    queryFn: () => getBalance(smartAccount!),
    enabled: open && !!smartAccount && isConnected,
  });

  const withdraw = useMutation({
    mutationFn: async () => {
      if (!address || !smartAccount || !smartAccountClient || !usdtAddress) {
        throw new Error("Missing wallet or config");
      }
      const amountBaseUnits = parseUnits(amountStr || "0", 6);
      if (amountBaseUnits <= BigInt(0)) throw new Error("Invalid amount");

      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [address as `0x${string}`, amountBaseUnits],
      });

      const client = smartAccountClient as WithdrawSmartWalletClient;
      const { id } = await client.sendCalls({
        calls: [{ to: usdtAddress, data: data as Hex, value: "0x0" }],
        from: smartAccount as Address,
        capabilities: {
          paymasterService: { policyId: PAYMASTER_POLICY_ID },
        },
      });
      const status = await client.waitForCallsStatus({ id });
      const txHash = status.receipts?.[0]?.transactionHash ?? id;
      return String(txHash);
    },
    onSuccess: (txHash) => {
      toast.success(`Withdrawal submitted: ${txHash}`);
      void qc.invalidateQueries({ queryKey: ["balance", smartAccount?.toLowerCase()] });
      onClose();
    },
    onError: (e: Error) => toast.error(formatUserFacingError(e)),
  });

  if (!open) return null;

  if (!sessionReady) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button type="button" className="absolute inset-0 bg-overlay" aria-label="Close" onClick={onClose} />
        <div className={cn("card-kraken relative z-10 w-full max-w-md p-6 shadow-card-hover")}>
          <h2 className="font-display text-xl font-bold text-foreground">Withdraw USDT</h2>
          <p className="mt-2 text-sm text-muted">Please complete connection first</p>
          <button type="button" className="btn-secondary mt-6 w-full" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-overlay" aria-label="Close" onClick={onClose} />
      <div className={cn("card-kraken relative z-10 w-full max-w-md p-6 shadow-card-hover")}>
        <h2 className="font-display text-xl font-bold text-foreground">Withdraw USDT</h2>
        <p className="mt-2 text-sm text-muted">
          Send USDT from your smart account to your connected wallet. This uses a sponsored user operation signed by
          your wallet (owner), not the trading session key.
        </p>
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
          {withdraw.isPending ? "Submitting…" : "Withdraw"}
        </button>
        <button type="button" className="btn-secondary mt-3 w-full" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

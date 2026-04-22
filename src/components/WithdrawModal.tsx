"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useAtomValue } from "jotai";
import { encodeFunctionData, erc20Abi, parseUnits, type Address, type Hex } from "viem";
import { toast } from "sonner";
import { getBalance } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatUsdt } from "@/lib/format";
import { formatUserFacingError } from "@/lib/errors";
import { userSmartAccount, userSmartAccountClient, apiConfigAtom, sessionReadyAtom } from "@/store/atoms";
import { PAYMASTER_POLICY_ID } from "@/config/environment";
import { Modal } from "./Modal";

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
  const [amountError, setAmountError] = useState("");
  const qc = useQueryClient();
  const smartAccountClient = useAtomValue(userSmartAccountClient);
  const smartAccount = useAtomValue(userSmartAccount);
  const apiConfig = useAtomValue(apiConfigAtom);
  const sessionReady = useAtomValue(sessionReadyAtom);

  const usdtAddress = apiConfig?.usdtAddress as Address | undefined;
  const configReady = !!apiConfig?.usdtAddress;

  const { data: bal } = useQuery({
    queryKey: ["balance", address?.toLowerCase() ?? ""],
    queryFn: () => getBalance(address!),
    enabled: open && !!address && isConnected,
  });

  const withdraw = useMutation({
    mutationFn: async () => {
      if (!address || !smartAccount || !smartAccountClient || !usdtAddress) {
        throw new Error("Missing wallet or config");
      }
      const amountBaseUnits = parseUnits(amountStr || "0", 6);
      if (amountBaseUnits <= BigInt(0)) throw new Error("Invalid amount");

      const maxAvailable = BigInt(bal?.available ?? "0");
      if (amountBaseUnits > maxAvailable) {
        throw new Error(
          "Amount exceeds available balance. Funds reserved for open orders are not withdrawable.",
        );
      }

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
      void qc.invalidateQueries({ queryKey: ["balance", address?.toLowerCase()] });
      setAmountError("");
      onClose();
    },
    onError: (e: Error) => toast.error(formatUserFacingError(e)),
  });

  if (!sessionReady) {
    return (
      <Modal open={open} onClose={onClose} title="Withdraw USDT" width={420}>
        <p className="pp-body" style={{ color: "var(--fg-1)" }}>
          Complete connection first.
        </p>
        <button
          type="button"
          className="pp-btn pp-btn--secondary pp-btn--lg pp-modal__cta"
          onClick={onClose}
        >
          Close
        </button>
      </Modal>
    );
  }

  const submitDisabled =
    withdraw.isPending ||
    !isConnected ||
    !configReady ||
    !smartAccountClient ||
    !usdtAddress ||
    !bal ||
    !!amountError ||
    amountStr === "";

  function onAmountChange(v: string) {
    setAmountStr(v);
    setAmountError("");
  }

  function onSubmitClick() {
    setAmountError("");
    if (!bal) return;
    let amountBaseUnits: bigint;
    try {
      amountBaseUnits = parseUnits(amountStr || "0", 6);
    } catch {
      setAmountError("Enter a valid USDT amount.");
      return;
    }
    if (amountBaseUnits <= BigInt(0)) {
      setAmountError("Enter an amount greater than zero.");
      return;
    }
    const maxAvailable = BigInt(bal.available ?? "0");
    if (amountBaseUnits > maxAvailable) {
      setAmountError(
        "Amount exceeds available balance. Funds reserved for open orders are not withdrawable.",
      );
      return;
    }
    void withdraw.mutate();
  }

  return (
    <Modal open={open} onClose={onClose} title="Withdraw USDT" width={420}>
      <p className="pp-body" style={{ color: "var(--fg-1)" }}>
        Sends USDT from your smart account to your connected wallet. Signed by your wallet (owner), not the
        trading session key.
      </p>

      <div className="pp-kv" style={{ marginTop: 14 }}>
        <span className="pp-micro">Available</span>
        <span className="pp-tabular" style={{ color: "var(--fg-0)" }}>
          ${bal ? formatUsdt(bal.available) : "—"}
        </span>
      </div>

      <div style={{ marginTop: 14 }}>
        <label className="pp-micro" htmlFor="withdraw-amount">
          Amount · USDT
        </label>
        <input
          id="withdraw-amount"
          inputMode="decimal"
          value={amountStr}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder="0.00"
          className={cn("pp-input pp-input--mono", !!amountError && "pp-input--invalid")}
          style={{ marginTop: 4 }}
        />
        {amountError && (
          <p className="pp-caption pp-down" style={{ marginTop: 4 }}>
            {amountError}
          </p>
        )}
        {!configReady && (
          <p className="pp-caption pp-down" style={{ marginTop: 4 }}>
            Config is still loading. Try again in a moment.
          </p>
        )}
      </div>

      <div className="pp-modal__row" style={{ marginTop: 20 }}>
        <button
          type="button"
          className="pp-btn pp-btn--secondary pp-btn--md"
          onClick={onClose}
          disabled={withdraw.isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="pp-btn pp-btn--primary pp-btn--md"
          disabled={submitDisabled}
          onClick={onSubmitClick}
        >
          {withdraw.isPending ? "Submitting…" : "Withdraw"}
        </button>
      </div>
    </Modal>
  );
}

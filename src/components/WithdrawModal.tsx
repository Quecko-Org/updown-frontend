"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { useAtomValue } from "jotai";
import { encodeFunctionData, erc20Abi, parseUnits, isAddress } from "viem";
import { toast } from "sonner";
import { Modal } from "./Modal";
import { activeChain, tokenSymbolForActiveChain } from "@/config/environment";
import { apiConfigAtom, userSmartAccount, balanceSnapshotAtom } from "@/store/atoms";
import { postThinWalletExecuteWithSig } from "@/lib/api";
import { formatUsdt } from "@/lib/format";
import { formatUserFacingError, isUserRejection } from "@/lib/errors";

/**
 * Phase 4 PR-A (2026-05-16): real meta-tx withdraw.
 *
 * Under Phase 4 the user's USDTM lives on their ThinWallet, not the EOA.
 * Withdrawing means calling `USDTM.transfer(destination, amount)` from
 * the TW. We do that via the same `executeWithSig` meta-tx pattern as
 * the deposit-approve flow:
 *   1. User picks destination (defaults to their EOA) + amount
 *   2. User signs an EIP-712 envelope authorizing `TW.executeWithSig(
 *        USDTM, encodeFunctionData(transfer, [dest, amount]),
 *        nonce, deadline, sig)`
 *   3. Relayer broadcasts. USDTM lands at destination. User pays zero gas.
 *
 * Defaulting destination to the connected EOA covers the 95% "withdraw to
 * my wallet" case with one signature popup. Editable destination handles
 * "send to a friend / CEX" without a separate tx.
 *
 * Path-1 fallback (no factory on chain): the modal still works because
 * `userSmartAccount` atom is set to EOA in that case — `executeWithSig`
 * fires against an EOA-as-TW which doesn't exist, so the POST would 502.
 * In practice Path-1 chains shouldn't see this modal in the same shape
 * (their USDT IS on the EOA); the legacy wagmi `useWriteContract` path
 * would apply. For the active Sepolia-only Phase 4 dev deployment, this
 * branch is the only one we exercise.
 */

type Props = {
  open: boolean;
  onClose: () => void;
};

function randomUint256AsString(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex).toString();
}

export function WithdrawModal({ open, onClose }: Props) {
  const { address } = useAccount();
  const apiConfig = useAtomValue(apiConfigAtom);
  const smartAccount = useAtomValue(userSmartAccount);
  const balance = useAtomValue(balanceSnapshotAtom);
  const { signTypedDataAsync } = useSignTypedData();

  const tokenSymbol = tokenSymbolForActiveChain();
  const chainName = activeChain.name;

  // Form state
  const [destination, setDestination] = useState<string>("");
  const [amountInput, setAmountInput] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill destination with connected EOA when modal opens.
  useEffect(() => {
    if (open && address && !destination) setDestination(address);
  }, [open, address, destination]);

  // Reset state on close.
  useEffect(() => {
    if (!open) {
      setDestination("");
      setAmountInput("");
      setSubmitting(false);
    }
  }, [open]);

  const availableAtomic = useMemo<bigint>(() => {
    try {
      return BigInt(balance?.available ?? "0");
    } catch {
      return BigInt(0);
    }
  }, [balance?.available]);
  const availableFormatted = formatUsdt(availableAtomic.toString());

  const amountAtomic = useMemo<bigint | null>(() => {
    if (!amountInput) return null;
    try {
      return parseUnits(amountInput, 6); // USDTM = 6 decimals
    } catch {
      return null;
    }
  }, [amountInput]);

  const destinationValid = isAddress(destination);
  const amountValid = amountAtomic != null && amountAtomic > BigInt(0);
  const amountInRange = amountValid && amountAtomic! <= availableAtomic;
  const canSubmit =
    !!smartAccount && !!apiConfig && !!address && destinationValid && amountInRange && !submitting;

  async function handleSubmit() {
    if (!smartAccount) {
      toast.error("Wallet not ready — finish sign-in first");
      return;
    }
    if (!apiConfig) {
      toast.error("Config not loaded — try again in a moment");
      return;
    }
    if (!address) {
      toast.error("Wallet not connected");
      return;
    }
    if (!destinationValid) {
      toast.error("Destination must be a valid 0x address");
      return;
    }
    if (!amountInRange) {
      toast.error(`Amount must be > 0 and ≤ ${availableFormatted} ${tokenSymbol}`);
      return;
    }

    setSubmitting(true);
    try {
      const usdtm = apiConfig.usdtAddress as `0x${string}`;
      const transferCalldata = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [destination as `0x${string}`, amountAtomic!],
      });
      const nonceStr = randomUint256AsString();
      const deadline = Math.floor(Date.now() / 1000) + 60 * 60;

      const twDomain = {
        name: "PulsePairsThinWallet",
        version: "1",
        chainId: apiConfig.chainId,
        verifyingContract: smartAccount as `0x${string}`,
      } as const;
      const execTypes = {
        ExecuteWithSig: [
          { name: "target", type: "address" },
          { name: "data", type: "bytes" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      } as const;

      const signature = await signTypedDataAsync({
        domain: twDomain,
        types: execTypes,
        primaryType: "ExecuteWithSig",
        message: {
          target: usdtm,
          data: transferCalldata,
          nonce: BigInt(nonceStr),
          deadline: BigInt(deadline),
        },
      });

      const result = await postThinWalletExecuteWithSig({
        eoa: address as `0x${string}`,
        signedAuth: {
          target: usdtm,
          data: transferCalldata,
          nonce: nonceStr,
          deadline,
          signature,
        },
      });

      toast.success(`Withdraw broadcast — tx ${result.txHash.slice(0, 10)}…`);
      onClose();
    } catch (e) {
      if (isUserRejection(e)) {
        toast.info("Withdraw cancelled in wallet.");
      } else {
        toast.error(formatUserFacingError(e));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Withdraw ${tokenSymbol}`} width={460}>
      <p className="pp-body" style={{ color: "var(--fg-1)" }}>
        Send {tokenSymbol} from your account to any address on {chainName}. Defaults to your connected wallet.
        Relayer broadcasts the transfer — no gas required from you.
      </p>

      <div className="pp-kv" style={{ marginTop: 14 }}>
        <span className="pp-micro">From (your account)</span>
        <span
          className="pp-tabular"
          style={{ color: "var(--fg-0)", wordBreak: "break-all" }}
        >
          {smartAccount || "—"}
        </span>
        <span className="pp-micro">Available</span>
        <span className="pp-body-strong">
          {availableFormatted} {tokenSymbol}
        </span>
        <span className="pp-micro">Network</span>
        <span className="pp-body-strong">{chainName}</span>
      </div>

      <div style={{ marginTop: 18 }}>
        <label className="pp-micro" style={{ display: "block", marginBottom: 6 }}>
          Destination address
        </label>
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          value={destination}
          onChange={(e) => setDestination(e.target.value.trim())}
          placeholder="0x…"
          className="pp-input"
          style={{
            width: "100%",
            padding: "10px 12px",
            background: "var(--bg-0)",
            border: `1px solid ${destinationValid || destination === "" ? "var(--border-0)" : "var(--down)"}`,
            borderRadius: 4,
            color: "var(--fg-0)",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 13,
          }}
        />
        {destination && !destinationValid ? (
          <p className="pp-micro" style={{ color: "var(--down)", marginTop: 4 }}>
            Not a valid 0x address.
          </p>
        ) : null}
      </div>

      <div style={{ marginTop: 14 }}>
        <label className="pp-micro" style={{ display: "block", marginBottom: 6 }}>
          Amount ({tokenSymbol})
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            inputMode="decimal"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.00"
            className="pp-input"
            style={{
              flex: 1,
              padding: "10px 12px",
              background: "var(--bg-0)",
              border: `1px solid ${
                amountValid && (amountInput === "" || amountInRange)
                  ? "var(--border-0)"
                  : amountInput
                    ? "var(--down)"
                    : "var(--border-0)"
              }`,
              borderRadius: 4,
              color: "var(--fg-0)",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 13,
            }}
          />
          <button
            type="button"
            className="pp-btn pp-btn--ghost pp-btn--sm"
            onClick={() => setAmountInput(formatUsdt(availableAtomic.toString()))}
            disabled={availableAtomic === BigInt(0)}
          >
            Max
          </button>
        </div>
        {amountInput && amountValid && !amountInRange ? (
          <p className="pp-micro" style={{ color: "var(--down)", marginTop: 4 }}>
            Exceeds available balance.
          </p>
        ) : null}
      </div>

      <div className="pp-modal__row" style={{ marginTop: 22, display: "flex", gap: 10 }}>
        <button
          type="button"
          className="pp-btn pp-btn--secondary pp-btn--lg"
          onClick={onClose}
          disabled={submitting}
          style={{ flex: 1 }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="pp-btn pp-btn--primary pp-btn--lg"
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{ flex: 1 }}
          title={
            !smartAccount
              ? "Finish wallet sign-in"
              : !destinationValid
                ? "Enter a valid destination address"
                : !amountValid
                  ? "Enter an amount"
                  : !amountInRange
                    ? "Amount exceeds available balance"
                    : undefined
          }
        >
          {submitting ? "Withdrawing…" : `Withdraw ${tokenSymbol}`}
        </button>
      </div>
    </Modal>
  );
}

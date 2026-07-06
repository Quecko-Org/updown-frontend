"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useAtomValue } from "jotai";
import { parseUnits, isAddress } from "viem";
import { toast } from "sonner";
import { Modal } from "./Modal";
import { activeChain, tokenSymbolForActiveChain } from "@/config/environment";
import {
  apiConfigAtom,
  userSmartAccount,
  userSmartAccountClient,
  balanceSnapshotAtom,
} from "@/store/atoms";
import { formatUsdt } from "@/lib/format";
import { formatUserFacingError, isUserRejection } from "@/lib/errors";

/**
 * Account Kit withdraw: the user's USDT lives on their SCA. Withdrawing is
 * one UserOp calling `USDT.transfer(destination, amount)` from the SCA
 * (`ak.withdraw`), signed by the owner key — no relayer, no meta-tx.
 *
 * Defaulting destination to the connected EOA covers the 95% "withdraw to
 * my wallet" case with one signature popup. Editable destination handles
 * "send to a friend / CEX" without a separate tx.
 */

type Props = {
  open: boolean;
  onClose: () => void;
};

export function WithdrawModal({ open, onClose }: Props) {
  const { address } = useAccount();
  const apiConfig = useAtomValue(apiConfigAtom);
  const smartAccount = useAtomValue(userSmartAccount);
  const ak = useAtomValue(userSmartAccountClient);
  const balance = useAtomValue(balanceSnapshotAtom);

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
    if (!smartAccount || !ak) {
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
      const txHash = await ak.withdraw({
        usdt: usdtm,
        to: destination as `0x${string}`,
        amount: amountAtomic!,
      });

      toast.success(`Withdraw broadcast — tx ${txHash.slice(0, 10)}…`);
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
        One signature — your smart account sends the transfer.
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

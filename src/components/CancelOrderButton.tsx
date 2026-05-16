"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useSignTypedData } from "wagmi";
import { toast } from "sonner";
import {
  buildCancelTypedData,
  CANCEL_TYPES,
  freshCancelNonce,
  cancelExpirySeconds,
} from "@/lib/eip712";
import { cancelOrder } from "@/lib/api";
import { formatUserFacingError } from "@/lib/errors";
import { apiConfigAtom, userSmartAccount } from "@/store/atoms";
import { signTypedDataViaThinWallet } from "@/lib/signOrderViaThinWallet";
import { cn } from "@/lib/cn";

/**
 * Small per-row Cancel button for OPEN / PARTIALLY_FILLED orders.
 *
 * Phase 4 PR-A (2026-05-16): the cancel sig must validate against `order.maker
 * = TW address`. Pre-fix it signed with the EOA and submitted `maker = EOA`,
 * which the backend's `verifyCancelSignature` rejected because the order it
 * tried to match had `maker = TW`. Same WalletAuth-wrap pattern as the
 * order-sign path in TradeForm: hash the Cancel typed-data against Settlement's
 * domain, wrap in WalletAuth against the TW's domain, sign with the EOA.
 * Backend's `SignatureService.verifyCancelSignature` uses viem's
 * `verifyTypedData` which dispatches to ERC-1271 when `maker` is a contract.
 *
 * Path-1 fallback: when `smartAccount === walletAddress` (no factory on this
 * chain), the WalletAuth wrap is unnecessary — but harmless. The contract
 * deployed for the EOA-as-TW case would still validate. (Practically: on
 * Path-1 chains, `smartAccount` IS the EOA and the wrap path won't execute
 * because no TW exists. Cancel would need a plain ECDSA sig instead.) We
 * branch on whether smartAccount differs from walletAddress in the
 * signing path below.
 */
export function CancelOrderButton({
  orderId,
  className,
}: {
  orderId: string;
  className?: string;
}) {
  const { signTypedDataAsync } = useSignTypedData();
  const apiConfig = useAtomValue(apiConfigAtom);
  const smartAccount = useAtomValue(userSmartAccount);
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);

  const cancel = useMutation({
    mutationFn: async () => {
      if (!smartAccount) throw new Error("Wallet not ready — finish sign-in first");
      if (!apiConfig) throw new Error("Config not loaded yet — try again in a moment");
      // PR-13: each cancel sig is unique-per-attempt (random nonce + 5-min
      // expiry) so a leaked sig can't replay forever.
      const nonce = freshCancelNonce();
      const expiry = cancelExpirySeconds();
      const maker = smartAccount as `0x${string}`;

      // Phase 4: order.maker is the TW. Cancel sig wraps the Cancel digest
      // in a WalletAuth envelope so the on-chain SignatureChecker route on
      // the backend (`SignatureService.verifyCancelSignature` → viem's
      // verifyTypedData → ERC-1271 dispatch to TW.isValidSignature) succeeds.
      const cancelMsg = {
        maker,
        orderId,
        nonce,
        expiry,
      };
      const typed = buildCancelTypedData(apiConfig, maker, orderId, nonce, expiry);
      const signature = await signTypedDataViaThinWallet({
        sourceDomain: typed.domain,
        sourceTypes: CANCEL_TYPES,
        sourcePrimaryType: "Cancel",
        sourceMessage: cancelMsg,
        twAddress: maker,
        chainId: apiConfig.chainId,
        signTypedDataAsync,
      });
      await cancelOrder(orderId, { maker, signature, nonce, expiry });
    },
    onSuccess: () => {
      toast.info("Cancel submitted");
      qc.invalidateQueries({
        queryKey: ["orders", smartAccount?.toLowerCase() ?? ""],
      });
      setPending(false);
    },
    onError: (e: Error) => {
      toast.error(formatUserFacingError(e));
      setPending(false);
    },
  });

  const disabled = cancel.isPending || pending || !smartAccount;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        setPending(true);
        cancel.mutate();
      }}
      className={cn("pp-btn pp-btn--ghost pp-btn--sm", className)}
      style={{ color: "var(--fg-2)" }}
      title={smartAccount ? "Cancel this order" : "Finish wallet sign-in to cancel"}
    >
      {cancel.isPending || pending ? "Cancelling…" : "Cancel"}
    </button>
  );
}

"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { toast } from "sonner";
import {
  buildCancelTypedData,
  freshCancelNonce,
  cancelExpirySeconds,
} from "@/lib/eip712";
import { cancelOrder } from "@/lib/api";
import { formatUserFacingError } from "@/lib/errors";
import { apiConfigAtom, userSmartAccount, userSmartAccountClient } from "@/store/atoms";
import { cn } from "@/lib/cn";

/**
 * Small per-row Cancel button for OPEN / PARTIALLY_FILLED orders.
 *
 * Account Kit: `order.maker` is the user's SCA, so the cancel signature is
 * the owner-signed Cancel typed-data as a bare ERC-1271 sig
 * (`ak.signTypedDataBare`) — same path as order signing in TradeForm.
 * Backend's `SignatureService.verifyCancelSignature` uses viem's
 * `verifyTypedData`, which dispatches to ERC-1271 when `maker` is a contract.
 */
export function CancelOrderButton({
  orderId,
  className,
}: {
  orderId: string;
  className?: string;
}) {
  const apiConfig = useAtomValue(apiConfigAtom);
  const smartAccount = useAtomValue(userSmartAccount);
  const ak = useAtomValue(userSmartAccountClient);
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);

  const cancel = useMutation({
    mutationFn: async () => {
      if (!smartAccount || !ak) throw new Error("Wallet not ready — finish sign-in first");
      if (!apiConfig) throw new Error("Config not loaded yet — try again in a moment");
      // PR-13: each cancel sig is unique-per-attempt (random nonce + 5-min
      // expiry) so a leaked sig can't replay forever.
      const nonce = freshCancelNonce();
      const expiry = cancelExpirySeconds();
      const maker = smartAccount as `0x${string}`;

      const typed = buildCancelTypedData(apiConfig, maker, orderId, nonce, expiry);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signature = await ak.signTypedDataBare(typed as any);
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

"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useAccount, useSignTypedData } from "wagmi";
import { toast } from "sonner";
import { buildCancelTypedData } from "@/lib/eip712";
import { cancelOrder } from "@/lib/api";
import { formatUserFacingError } from "@/lib/errors";
import { apiConfigAtom } from "@/store/atoms";
import { cn } from "@/lib/cn";

/**
 * Small per-row Cancel button for OPEN / PARTIALLY_FILLED orders.
 * Signs an EIP-712 Cancel message, submits DELETE /orders/:id, and invalidates
 * the `["orders", <eoa>]` cache so the row's status flips to CANCEL_PENDING
 * immediately. The terminal CANCELLED state + toast land via the WS
 * order_update frame once the engine processes the queued cancel.
 */
export function CancelOrderButton({
  orderId,
  className,
}: {
  orderId: string;
  className?: string;
}) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const apiConfig = useAtomValue(apiConfigAtom);
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);

  const cancel = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("Connect wallet");
      if (!apiConfig) throw new Error("Config not loaded yet — try again in a moment");
      const typed = buildCancelTypedData(apiConfig, address as `0x${string}`, orderId);
      const signature = await signTypedDataAsync(typed);
      await cancelOrder(orderId, { maker: address, signature });
    },
    onSuccess: () => {
      toast.info("Cancel submitted");
      qc.invalidateQueries({ queryKey: ["orders", address?.toLowerCase() ?? ""] });
      setPending(false);
    },
    onError: (e: Error) => {
      toast.error(formatUserFacingError(e));
      setPending(false);
    },
  });

  return (
    <button
      type="button"
      disabled={cancel.isPending || pending || !address}
      onClick={() => {
        setPending(true);
        cancel.mutate();
      }}
      className={cn(
        "rounded-md px-2 py-1 text-xs font-semibold transition-colors",
        "border border-border text-muted hover:border-down hover:text-down",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      title={address ? "Cancel this order" : "Connect wallet to cancel"}
    >
      {cancel.isPending || pending ? "Cancelling…" : "Cancel"}
    </button>
  );
}

"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { deleteAllMarketOrders } from "@/lib/api";
import { formatUserFacingError } from "@/lib/errors";
import { ConfirmModal } from "@/components/ConfirmModal";

export function CancelAllMarketOrders({ marketComposite }: { marketComposite: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const key = marketComposite.toLowerCase();

  const cancel = useMutation({
    mutationFn: () => deleteAllMarketOrders(marketComposite),
    onSuccess: () => {
      toast.success("All your orders in this market were canceled");
      void qc.invalidateQueries({ queryKey: ["orderbook", key] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(formatUserFacingError(e)),
  });

  return (
    <>
      <button
        type="button"
        className="rounded-[12px] bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        onClick={() => setOpen(true)}
      >
        Cancel all
      </button>
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        title="Cancel all orders?"
        message="Cancel all your orders in this market?"
        confirmLabel="Cancel all"
        confirmClassName="rounded-[12px] bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
    </>
  );
}

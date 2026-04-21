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
        className="pp-btn pp-btn--down pp-btn--md"
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
        confirmClassName="pp-btn pp-btn--down pp-btn--md"
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
    </>
  );
}

"use client";

import { cn } from "@/lib/cn";

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmClassName?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  confirmClassName,
  loading,
  onConfirm,
  onClose,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-overlay" aria-label="Close" onClick={onClose} />
      <div className={cn("card-kraken relative z-10 w-full max-w-md p-6 shadow-card-hover")}>
        <h2 className="font-display text-xl font-bold tracking-tight text-foreground">{title}</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">{message}</p>
        <div className="mt-6 flex gap-3">
          <button type="button" className="btn-secondary flex-1" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className={cn("flex-1 rounded-[12px] px-4 py-3 text-sm font-semibold text-white", confirmClassName ?? "btn-primary")}
            onClick={() => onConfirm()}
            disabled={loading}
          >
            {loading ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

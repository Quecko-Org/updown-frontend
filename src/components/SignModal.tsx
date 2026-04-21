"use client";

import { cn } from "@/lib/cn";

type Props = {
  open: boolean;
  onSign: () => void;
  onCancel: () => void;
};

export function SignModal({ open, onSign, onCancel }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-overlay"
        aria-label="Cancel and disconnect"
        onClick={onCancel}
      />
      <div className={cn("card-kraken relative z-10 w-full max-w-md p-6 shadow-card-hover")}>
        <h2 className="pp-h2">Verify wallet</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Sign a message with your wallet to create your smart account and enable trading.
        </p>
        <button type="button" className="btn-primary mt-6 w-full" onClick={onSign}>
          Sign message
        </button>
        <button type="button" className="btn-secondary mt-3 w-full" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

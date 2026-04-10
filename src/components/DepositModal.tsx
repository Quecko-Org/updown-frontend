"use client";

import { QRCodeSVG } from "qrcode.react";
import { cn } from "@/lib/cn";

type Props = {
  open: boolean;
  onClose: () => void;
  relayerAddress: string;
};

export function DepositModal({ open, onClose, relayerAddress }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-overlay"
        aria-label="Close"
        onClick={onClose}
      />
      <div className={cn("card-kraken relative z-10 w-full max-w-md p-6 shadow-card-hover")}>
        <h2 className="font-display text-xl font-bold tracking-tight text-foreground">Deposit USDT</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Send USDT on Arbitrum to the relayer address below. Your balance updates after confirmations
          (WebSocket or polling).
        </p>
        <div className="mt-5 flex justify-center rounded-[12px] border border-border bg-surface-muted/40 p-5">
          <QRCodeSVG value={relayerAddress || " "} size={180} level="M" />
        </div>
        <p className="mt-4 break-all rounded-[12px] bg-surface-muted px-3 py-3 font-mono text-xs leading-relaxed text-foreground">
          {relayerAddress || "—"}
        </p>
        <button type="button" className="btn-primary mt-6 w-full" onClick={() => navigator.clipboard.writeText(relayerAddress)}>
          Copy address
        </button>
        <button type="button" className="btn-secondary mt-3 w-full" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

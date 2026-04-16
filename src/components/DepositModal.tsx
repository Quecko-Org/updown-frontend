"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { cn } from "@/lib/cn";
import { useGetUsdtBalance } from "@/hooks/useBalance";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Smart account address — where users send USDT to deposit. */
  smartAccountAddress: string;
};

export function DepositModal({ open, onClose, smartAccountAddress }: Props) {
  const [isCopied, setIsCopied] = useState(false);
  const { balance } = useGetUsdtBalance();

  const handleCopy = async () => {
    if (!smartAccountAddress) return;
    try {
      await navigator.clipboard.writeText(smartAccountAddress);
      setIsCopied(true);
      toast.success("Address copied");
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // Fallback for older browsers / insecure contexts
      const textarea = document.createElement("textarea");
      textarea.value = smartAccountAddress;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
        setIsCopied(true);
        toast.success("Address copied");
        setTimeout(() => setIsCopied(false), 2000);
      } catch {
        toast.error("Copy failed — please copy manually");
      }
      document.body.removeChild(textarea);
    }
  };

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
          Send USDT on Arbitrum to your smart account address below. Your balance updates after confirmations.
        </p>

        {/* Smart account balance */}
        <div className="mt-4 flex items-center justify-between rounded-[12px] border border-border bg-surface-muted/40 px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Balance</span>
          <span className="font-mono text-sm font-bold tabular-nums text-foreground">
            ${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        {/* QR code */}
        <div className="mt-4 flex justify-center rounded-[12px] border border-border bg-white p-5">
          <QRCodeSVG value={smartAccountAddress || " "} size={180} level="M" />
        </div>

        {/* Address */}
        <p className="mt-4 break-all rounded-[12px] bg-surface-muted px-3 py-3 font-mono text-xs leading-relaxed text-foreground">
          {smartAccountAddress || "—"}
        </p>

        <button
          type="button"
          className="btn-primary mt-6 w-full"
          onClick={() => void handleCopy()}
          disabled={!smartAccountAddress}
        >
          {isCopied ? "Copied!" : "Copy address"}
        </button>
        <button type="button" className="btn-secondary mt-3 w-full" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

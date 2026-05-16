"use client";

import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Modal } from "./Modal";
import { activeChain, tokenSymbolForActiveChain } from "@/config/environment";

type Props = {
  open: boolean;
  onClose: () => void;
  depositAddress: string;
};

export function DepositModal({ open, onClose, depositAddress }: Props) {
  const address = depositAddress || "";
  const canCopy = address.length > 0;
  const tokenSymbol = tokenSymbolForActiveChain();
  const chainName = activeChain.name;

  function copy() {
    if (!canCopy) return;
    navigator.clipboard.writeText(address);
    toast.success("Address copied");
  }

  return (
    <Modal open={open} onClose={onClose} title={`Deposit ${tokenSymbol}`} width={420}>
      <p className="pp-body" style={{ color: "var(--fg-1)" }}>
        Send {tokenSymbol} on {chainName} to the smart-account address below. Funds stay under your control — the backend
        only uses them for trades you authorize.
      </p>

      <div className="pp-kv" style={{ marginTop: 14 }}>
        <span className="pp-micro">Network</span>
        <span className="pp-body-strong">{chainName}</span>
        <span className="pp-micro">Asset</span>
        <span className="pp-body-strong">{tokenSymbol}</span>
      </div>

      <div className="pp-qr" style={{ padding: "18px 0" }}>
        <QRCodeSVG value={address || " "} size={140} level="M" bgColor="#ffffff" fgColor="#000000" />
      </div>

      <div>
        <span className="pp-micro">Address</span>
        <p
          className="pp-hash"
          style={{
            marginTop: 4,
            padding: "10px 12px",
            background: "var(--bg-0)",
            border: "1px solid var(--border-0)",
            borderRadius: 4,
            color: "var(--fg-0)",
            wordBreak: "break-all",
          }}
        >
          {address || "—"}
        </p>
      </div>

      <button
        type="button"
        className="pp-btn pp-btn--primary pp-btn--lg pp-modal__cta"
        onClick={copy}
        disabled={!canCopy}
      >
        Copy address
      </button>
    </Modal>
  );
}

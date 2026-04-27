"use client";

import { useAccount } from "wagmi";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * Path-1 architecture: USDT lives on the connected EOA directly. There is
 * no smart-account custodian to "withdraw from" — funds are already in
 * the user's wallet. The modal explains this and points them at their
 * wallet's native send UI for moving USDT elsewhere. The button stays
 * in the Header so the affordance is discoverable; the modal explains
 * the new mental model.
 */
export function WithdrawModal({ open, onClose }: Props) {
  const { address } = useAccount();

  return (
    <Modal open={open} onClose={onClose} title="Your USDT" width={420}>
      <p className="pp-body" style={{ color: "var(--fg-1)" }}>
        Your USDT lives on your connected wallet directly. To move it
        elsewhere, use your wallet&apos;s send feature — there&apos;s no
        custodial step on PulsePairs to withdraw from.
      </p>

      <div className="pp-kv" style={{ marginTop: 14 }}>
        <span className="pp-micro">Wallet</span>
        <span
          className="pp-tabular"
          style={{ color: "var(--fg-0)", wordBreak: "break-all" }}
        >
          {address ?? "—"}
        </span>
        <span className="pp-micro">Asset</span>
        <span className="pp-body-strong">USDT (Arbitrum One)</span>
      </div>

      <div className="pp-modal__row" style={{ marginTop: 20 }}>
        <button
          type="button"
          className="pp-btn pp-btn--secondary pp-btn--lg pp-modal__cta"
          onClick={onClose}
        >
          Got it
        </button>
      </div>
    </Modal>
  );
}

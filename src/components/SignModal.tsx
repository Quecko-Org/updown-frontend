"use client";

import { Modal } from "./Modal";

type Props = {
  open: boolean;
  onSign: () => void;
  onCancel: () => void;
};

export function SignModal({ open, onSign, onCancel }: Props) {
  return (
    <Modal open={open} onClose={onCancel} title="Authorize session" width={380} zIndex={100}>
      <p className="pp-body" style={{ color: "var(--fg-1)" }}>
        Sign a one-time message to create your smart account and enable trading. No gas.
      </p>
      <div className="pp-modal__row" style={{ marginTop: 20 }}>
        <button
          type="button"
          className="pp-btn pp-btn--secondary pp-btn--md"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="pp-btn pp-btn--primary pp-btn--md"
          onClick={onSign}
        >
          Sign
        </button>
      </div>
    </Modal>
  );
}

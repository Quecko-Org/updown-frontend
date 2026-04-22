"use client";

import { cn } from "@/lib/cn";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  /**
   * Override the confirm button class — callers pass a pp-btn variant (e.g.
   * `pp-btn pp-btn--down pp-btn--md` for destructive). Defaults to primary.
   */
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
  return (
    <Modal open={open} onClose={onClose} title={title} width={380} zIndex={100}>
      <p className="pp-body" style={{ color: "var(--fg-1)" }}>
        {message}
      </p>
      <div className="pp-modal__row" style={{ marginTop: 20 }}>
        <button
          type="button"
          className="pp-btn pp-btn--secondary pp-btn--md"
          onClick={onClose}
          disabled={loading}
        >
          Cancel
        </button>
        <button
          type="button"
          className={cn(confirmClassName ?? "pp-btn pp-btn--primary pp-btn--md")}
          onClick={() => onConfirm()}
          disabled={loading}
        >
          {loading ? "…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

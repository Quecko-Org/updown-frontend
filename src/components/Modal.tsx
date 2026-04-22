"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/cn";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Max content width in px. Mobile always clamps to 100% of scrim width. */
  width?: number;
  /**
   * z-index override — default 80 matches pp-scrim in pp-utilities.css.
   * Bump above 80 when one modal can legitimately overlay another (Sign,
   * Confirm are triggered inside flows where Deposit/Withdraw may be open).
   */
  zIndex?: number;
  className?: string;
};

/**
 * PulsePairs modal primitive. Wraps pp-scrim + pp-modal + pp-modal__hd
 * (title + close X) + pp-modal__body from pp-utilities.css. Escape closes;
 * scrim click closes; content click does not.
 *
 * Designed for the four in-app modals (Deposit / Withdraw / Sign / Confirm).
 * Not a full headless-ui replacement — we don't need focus trapping or a
 * portal at this scale (single-page trading app, modal lives inside its
 * parent React tree already).
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  width = 420,
  zIndex = 80,
  className,
}: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="pp-scrim"
      style={{ zIndex }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={cn("pp-modal", className)}
        style={{
          width: "100%",
          maxWidth: width,
          maxHeight: "calc(100vh - 32px)",
          overflow: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pp-modal__hd">
          <span className="pp-h3">{title}</span>
          <button
            type="button"
            className="pp-modal__x"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div className="pp-modal__body">{children}</div>
      </div>
    </div>
  );
}

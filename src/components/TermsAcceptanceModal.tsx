"use client";

import Link from "next/link";
import { useState } from "react";
import { Modal } from "./Modal";
import { TERMS_VERSION, acceptCurrentVersion } from "@/lib/termsAcceptance";

/**
 * Blocking acceptance modal shown the first time a wallet attempts to
 * trade (and again whenever TERMS_VERSION bumps). Three-link checkbox:
 * Terms, Privacy, Risk Disclosures. Persists per-wallet via localStorage
 * once the user clicks Accept; the parent re-checks `hasAcceptedCurrent
 * Version` on the next submit.
 *
 * Not auto-shown on connect — only on the first trade attempt — so
 * users can browse + connect without a forced legal interstitial.
 */
export function TermsAcceptanceModal({
  open,
  wallet,
  onAccepted,
  onDismiss,
}: {
  open: boolean;
  wallet: string | null | undefined;
  /** Fires after localStorage write completes. Parent typically closes the
   *  modal here and lets the user click Trade again. */
  onAccepted: () => void;
  /** User clicked the X / scrim. No state change, no localStorage write. */
  onDismiss: () => void;
}) {
  const [checked, setChecked] = useState(false);

  function handleAccept() {
    if (!wallet) return;
    if (!checked) return;
    acceptCurrentVersion(wallet);
    setChecked(false);
    onAccepted();
  }

  function handleClose() {
    setChecked(false);
    onDismiss();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Before you trade"
      width={460}
    >
      <div className="space-y-4">
        <p className="pp-body" style={{ color: "var(--fg-1)" }}>
          PulsePairs is a non-custodial trading protocol. Before placing your
          first order on this wallet, please review and accept the legal
          documents below.
        </p>

        <ul className="space-y-1.5">
          <li>
            <Link
              href="/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="pp-link"
            >
              Terms of Service →
            </Link>
          </li>
          <li>
            <Link
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="pp-link"
            >
              Privacy Policy →
            </Link>
          </li>
          <li>
            <Link
              href="/risk"
              target="_blank"
              rel="noopener noreferrer"
              className="pp-link"
            >
              Risk Disclosures →
            </Link>
          </li>
        </ul>

        <label
          className="flex items-start gap-3 rounded-[6px] border p-3 cursor-pointer"
          style={{ background: "var(--bg-0)", borderColor: "var(--border-0)" }}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-[3px]"
            aria-label="I agree to the Terms of Service, Privacy Policy, and Risk Disclosures"
          />
          <span className="pp-body" style={{ color: "var(--fg-1)" }}>
            I have read and agree to the Terms of Service, Privacy Policy, and
            Risk Disclosures.
          </span>
        </label>

        <p
          className="pp-caption pp-tabular"
          style={{ color: "var(--fg-2)" }}
        >
          Version {TERMS_VERSION} · Acceptance is recorded for this wallet
          locally. Re-acceptance is required if the version updates.
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            className="pp-btn pp-btn--ghost pp-btn--md"
            onClick={handleClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="pp-btn pp-btn--primary pp-btn--md"
            disabled={!checked || !wallet}
            onClick={handleAccept}
          >
            Accept &amp; continue
          </button>
        </div>
      </div>
    </Modal>
  );
}

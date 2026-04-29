"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useAtom } from "jotai";
import { cookieConsentAtom } from "@/store/atoms";
import {
  getCookieConsent,
  setCookieConsent,
  type CookieConsentStatus,
} from "@/lib/cookieConsent";

/**
 * Bottom-anchored consent banner. Renders only when the user hasn't
 * picked a side yet (`status === "unset"`). After Accept or Reject the
 * choice persists to localStorage and the banner disappears.
 *
 * Hydrates the atom from localStorage on first mount so analytics SDKs
 * that read the atom get a stable answer before they initialize.
 */
export function CookieConsentBanner() {
  const [status, setStatus] = useAtom(cookieConsentAtom);

  useEffect(() => {
    const stored = getCookieConsent();
    if (stored !== status) setStatus(stored);
    // Stable Jotai setter; only sync once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status !== "unset") return null;

  function decide(next: Exclude<CookieConsentStatus, "unset">) {
    setCookieConsent(next);
    setStatus(next);
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-consent-title"
      className="fixed bottom-0 left-0 right-0 z-[150] border-t"
      style={{
        background: "var(--bg-1)",
        borderColor: "var(--border-0)",
        boxShadow: "var(--shadow-overlay)",
      }}
    >
      <div className="mx-auto flex max-w-[1280px] flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6 lg:px-8">
        <div className="min-w-0 flex-1">
          <p
            id="cookie-consent-title"
            className="pp-body"
            style={{ color: "var(--fg-1)" }}
          >
            We use a small amount of analytics to improve PulsePairs. Strictly-
            necessary cookies always run; non-essential analytics need your
            consent. See our{" "}
            <Link href="/privacy" className="pp-link">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="pp-btn pp-btn--ghost pp-btn--sm"
            onClick={() => decide("rejected")}
          >
            Reject
          </button>
          <button
            type="button"
            className="pp-btn pp-btn--primary pp-btn--sm"
            onClick={() => decide("accepted")}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

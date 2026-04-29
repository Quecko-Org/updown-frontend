"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAtomValue } from "jotai";
import { cookieConsentAtom } from "@/store/atoms";
import { maybeInitialize, track } from "@/lib/analytics";

/**
 * Wires global analytics: re-checks consent state to initialize / reset
 * the PostHog SDK as the user toggles, and emits a `page_view` on every
 * route change once consent is granted.
 */
export function useAnalytics(): void {
  const consent = useAtomValue(cookieConsentAtom);
  const pathname = usePathname();

  // Re-check init on consent change (handles the "user accepts mid-session"
  // case so analytics start firing without a reload).
  useEffect(() => {
    if (consent === "accepted") maybeInitialize();
  }, [consent]);

  // Per-route page_view. Skip the first render before consent resolves
  // so we don't queue a no-op event.
  useEffect(() => {
    if (consent !== "accepted") return;
    if (!pathname) return;
    track("page_view", { path: pathname });
  }, [consent, pathname]);
}

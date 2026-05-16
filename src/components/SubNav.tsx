"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getRestoredMarketsHref } from "@/hooks/useLastMarketView";

/**
 * pr-fix-3 (2026-05-16) — sub-page navigation bar.
 *
 * Lives directly under `<Header />` (sticky), renders the `← Markets`
 * affordance on every non-homepage route. Replaces the back button that
 * used to live INSIDE `.pp-hdr__inner` — that placement broke the
 * 3-column header grid (4 children → row 2 overflow) and produced the
 * cross-route layout bug Meir surfaced in the 2026-05-16 audit.
 *
 * Renders `null` on `/` so the homepage's header sits cleanly against
 * the asset picker with no extra chrome.
 *
 * The back-link target is restored from sessionStorage via
 * `getRestoredMarketsHref()` — keeps the user's last `{asset, timeframe}`
 * intact across the round trip (same helper the in-header button used).
 */
export function SubNav() {
  const pathname = usePathname();
  if (pathname === "/") return null;

  return (
    <nav className="pp-subnav" role="navigation" aria-label="Back to markets">
      <div className="pp-subnav__inner">
        <Link
          href={getRestoredMarketsHref()}
          className="pp-subnav__back"
          aria-label="Back to markets"
        >
          <ArrowLeft size={16} />
          <span>Markets</span>
        </Link>
      </div>
    </nav>
  );
}

"use client";

import { Bookmark, Code2, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { isBookmarked, toggleBookmark } from "@/lib/bookmarks";
import { cn } from "@/lib/cn";

/**
 * Phase2-F market detail header actions: share / embed / bookmark icons.
 * Polymarket-parity placement — top-right of the market detail page,
 * adjacent to the back-link and the H1.
 *
 *  - Share: copies the canonical /market/<key> URL to clipboard, toast.
 *  - Embed: MVP placeholder — toast points users at the share link until
 *    a real iframe/embed surface ships. Documented in PR.
 *  - Bookmark: localStorage-only MVP. Toggles a per-market flag with
 *    immediate visual feedback. The bookmarks list isn't surfaced
 *    elsewhere yet (future phase: header dropdown).
 */
export function MarketHeaderActions({ marketKey }: { marketKey: string }) {
  const [bookmarked, setBookmarked] = useState(false);
  // Hydrate bookmark state on mount — localStorage isn't available during SSR.
  useEffect(() => {
    setBookmarked(isBookmarked(marketKey));
  }, [marketKey]);

  async function handleShare() {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard");
    } catch {
      // Clipboard API unavailable (insecure context, perms denied) — fall
      // back to a prompt-style copy by selecting the URL bar isn't viable
      // programmatically, so just surface the URL in the toast.
      toast.info(`Copy this link: ${url}`);
    }
  }

  function handleEmbed() {
    toast.info(
      "Embed iframe coming soon — share the link for now.",
      { duration: 3500 },
    );
  }

  function handleBookmark() {
    const next = toggleBookmark(marketKey);
    setBookmarked(next);
    toast.success(next ? "Bookmarked" : "Bookmark removed");
  }

  return (
    <div className="pp-mhdr-actions" role="toolbar" aria-label="Market actions">
      <button
        type="button"
        className="pp-mhdr-actions__btn"
        onClick={handleShare}
        aria-label="Copy share link"
        title="Copy share link"
      >
        <Share2 size={16} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        className="pp-mhdr-actions__btn"
        onClick={handleEmbed}
        aria-label="Get embed code"
        title="Embed (coming soon)"
      >
        <Code2 size={16} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        className={cn(
          "pp-mhdr-actions__btn",
          bookmarked && "pp-mhdr-actions__btn--on",
        )}
        onClick={handleBookmark}
        aria-pressed={bookmarked}
        aria-label={bookmarked ? "Remove bookmark" : "Add bookmark"}
        title={bookmarked ? "Bookmarked" : "Bookmark"}
      >
        <Bookmark
          size={16}
          strokeWidth={1.5}
          fill={bookmarked ? "currentColor" : "none"}
        />
      </button>
    </div>
  );
}

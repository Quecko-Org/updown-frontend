"use client";

import { Bookmark, Code2, MoreHorizontal, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
 *
 * 2026-05-17 detail-page redesign: added the overflow "⋯" menu that
 * hosts the "Copy contract address" action. The standalone <details>
 * block under the hero is gone — page chrome stays clean, advanced ops
 * live in the menu.
 */
export function MarketHeaderActions({
  marketKey,
  marketAddress,
}: {
  marketKey: string;
  /** Composite on-chain key (`0x{settlement}-{marketId}`). Surfaced via the
   *  overflow menu's "Copy contract address" action. Optional so existing
   *  callers without the data don't break — the menu item is hidden when
   *  unset. */
  marketAddress?: string;
}) {
  const [bookmarked, setBookmarked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Hydrate bookmark state on mount — localStorage isn't available during SSR.
  useEffect(() => {
    setBookmarked(isBookmarked(marketKey));
  }, [marketKey]);

  // Outside-click dismiss for the overflow menu. Mirrors the Header /
  // TradeForm long-press menu pattern.
  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  async function handleShare() {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard");
    } catch {
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

  async function handleCopyContract() {
    if (!marketAddress || typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(marketAddress);
      toast.success("Contract address copied");
    } catch {
      toast.info(`Contract: ${marketAddress}`);
    }
    setMenuOpen(false);
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
      <div ref={menuRef} className="pp-mhdr-actions__menu-wrap">
        <button
          type="button"
          className="pp-mhdr-actions__btn"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="More market actions"
          title="More"
        >
          <MoreHorizontal size={16} strokeWidth={1.5} />
        </button>
        {menuOpen ? (
          <div className="pp-mhdr-actions__menu" role="menu">
            {marketAddress ? (
              <button
                type="button"
                role="menuitem"
                className="pp-mhdr-actions__menu-item"
                onClick={handleCopyContract}
              >
                <span>Copy contract address</span>
                <span className="pp-mhdr-actions__menu-hint pp-hash">
                  {marketAddress.slice(0, 10)}…{marketAddress.slice(-6)}
                </span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * PR-4 navigation-friction fix.
 *
 * The markets surface lives at `/?asset=X&timeframe=Y`. When a user
 * navigates to /portfolio or /docs and returns via the PulsePairs
 * logo, they used to land on `/?asset=btc&timeframe=5m` (the default)
 * regardless of where they were. Same for back-button via browser
 * history when the previous entry wasn't a market route.
 *
 * Solution: stash {asset, timeframe} in sessionStorage on every render
 * of the markets page, then read it back when the logo / back-button
 * fires. sessionStorage (not localStorage) so the restoration only
 * applies within a single tab session — opening a fresh tab gets the
 * default, which is correct (a new tab is a new visit).
 *
 * Two exports:
 *   - `useTrackLastMarketView()` — call from the markets page render.
 *     Writes current query params on mount + on change.
 *   - `useRestoreLastMarketView()` — call from the header logo handler.
 *     Returns a `getRestoredHref()` that produces the `/?asset=X&tf=Y`
 *     URL to navigate to. Returns `/` when nothing stashed.
 */

const STORAGE_KEY = "pp:lastMarketView";

type Stashed = { asset: string; timeframe: string };

function readStash(): Stashed | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stashed>;
    if (typeof parsed?.asset !== "string" || typeof parsed?.timeframe !== "string") return null;
    return { asset: parsed.asset, timeframe: parsed.timeframe };
  } catch {
    return null;
  }
}

function writeStash(asset: string, timeframe: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ asset, timeframe }));
  } catch {
    // sessionStorage can throw in private-browsing modes — failure here
    // just means the user gets the default on next navigation. Not worth
    // a user-facing surface.
  }
}

export function useTrackLastMarketView(): void {
  const searchParams = useSearchParams();
  const asset = searchParams.get("asset") ?? "btc";
  const timeframe = searchParams.get("timeframe") ?? "5m";
  useEffect(() => {
    writeStash(asset, timeframe);
  }, [asset, timeframe]);
}

export function getRestoredMarketsHref(): string {
  const stash = readStash();
  if (!stash) return "/";
  const params = new URLSearchParams({ asset: stash.asset, timeframe: stash.timeframe });
  return `/?${params.toString()}`;
}

export function useRestoredMarketsHref(): string {
  const router = useRouter();
  void router;
  return getRestoredMarketsHref();
}

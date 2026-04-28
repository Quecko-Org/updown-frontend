/**
 * Local-only market bookmarks (Phase2-F MVP). Persists a Set of market
 * composite keys (settlement-address-id) in localStorage so the user can
 * toggle a star on any market detail page. No backend, no cross-device
 * sync — that's a future enhancement once we know which lifecycle anchors
 * (per-window short-lived markets vs. pair+timeframe series subscriptions)
 * users actually want.
 *
 * Storage key is versioned so future schema changes can migrate.
 */
const STORAGE_KEY = "pp.bookmarks.v1";

function safeRead(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function safeWrite(list: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* quota exceeded / disabled storage — fail silently */
  }
}

function normalize(key: string): string {
  return key.trim().toLowerCase();
}

export function getBookmarkedMarkets(): string[] {
  return safeRead();
}

export function isBookmarked(marketKey: string): boolean {
  const k = normalize(marketKey);
  return safeRead().some((x) => x.toLowerCase() === k);
}

/** Returns the new bookmarked state (true if added, false if removed). */
export function toggleBookmark(marketKey: string): boolean {
  const k = normalize(marketKey);
  const list = safeRead();
  const idx = list.findIndex((x) => x.toLowerCase() === k);
  if (idx >= 0) {
    list.splice(idx, 1);
    safeWrite(list);
    return false;
  }
  list.unshift(marketKey);
  safeWrite(list.slice(0, 50));
  return true;
}

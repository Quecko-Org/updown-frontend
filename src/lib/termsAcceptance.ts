/**
 * Versioned, per-wallet Terms acceptance tracking. Keeps a small map in
 * localStorage of `wallet → accepted version` so the modal only fires the
 * first time a given wallet connects (and again whenever TERMS_VERSION
 * bumps to force re-acknowledgement on material changes).
 *
 * Storage key is versioned ("v1") so future schema migrations stay clean.
 */

/**
 * Bump this whenever Terms / Privacy / Risk text changes materially.
 * Every connected wallet that hasn't accepted the new version will see
 * the modal again on their next trade attempt. Use semver-ish strings;
 * exact value isn't compared lexically — it's an equality check, so
 * "1.0.0" → "1.0.1" → "2.0.0" all force re-prompt.
 */
export const TERMS_VERSION = "1.0.0";

const STORAGE_KEY = "pp.terms.accepted.v1";

type AcceptedMap = Record<string, string>;

function safeRead(): AcceptedMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: AcceptedMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k.toLowerCase()] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function safeWrite(map: AcceptedMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota exceeded / disabled storage — fail silently */
  }
}

/** Returns the accepted version for `wallet`, or null if never accepted. */
export function getAcceptedVersion(wallet: string): string | null {
  return safeRead()[wallet.toLowerCase()] ?? null;
}

/** True iff the connected wallet has accepted the *current* TERMS_VERSION. */
export function hasAcceptedCurrentVersion(wallet: string): boolean {
  return getAcceptedVersion(wallet) === TERMS_VERSION;
}

/** Record acceptance of the current TERMS_VERSION for `wallet`. */
export function acceptCurrentVersion(wallet: string): void {
  const map = safeRead();
  map[wallet.toLowerCase()] = TERMS_VERSION;
  safeWrite(map);
}

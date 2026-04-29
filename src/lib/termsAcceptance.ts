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

/**
 * Storage value shape evolved: v1 originally stored just the version
 * string. We now also persist the acceptance timestamp so /settings can
 * surface it. Reads accept both shapes so existing accepted wallets
 * don't get re-prompted; subsequent writes always emit the object form.
 */
export type AcceptanceRecord = {
  version: string;
  acceptedAt: number;
};
type StoredValue = string | AcceptanceRecord;
type AcceptedMap = Record<string, StoredValue>;

function safeRead(): AcceptedMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: AcceptedMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") {
        out[k.toLowerCase()] = v;
      } else if (
        v &&
        typeof v === "object" &&
        "version" in v &&
        typeof (v as AcceptanceRecord).version === "string"
      ) {
        out[k.toLowerCase()] = v as AcceptanceRecord;
      }
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

function recordFor(value: StoredValue | undefined): AcceptanceRecord | null {
  if (!value) return null;
  if (typeof value === "string") return { version: value, acceptedAt: 0 };
  return value;
}

/** Returns the accepted version for `wallet`, or null if never accepted. */
export function getAcceptedVersion(wallet: string): string | null {
  return recordFor(safeRead()[wallet.toLowerCase()])?.version ?? null;
}

/**
 * Returns the full acceptance record (version + timestamp) for a wallet.
 * Pre-migration entries return `acceptedAt: 0` to signal "unknown date".
 */
export function getAcceptanceRecord(wallet: string): AcceptanceRecord | null {
  return recordFor(safeRead()[wallet.toLowerCase()]);
}

/** True iff the connected wallet has accepted the *current* TERMS_VERSION. */
export function hasAcceptedCurrentVersion(wallet: string): boolean {
  return getAcceptedVersion(wallet) === TERMS_VERSION;
}

/** Record acceptance of the current TERMS_VERSION for `wallet`. */
export function acceptCurrentVersion(wallet: string): void {
  const map = safeRead();
  map[wallet.toLowerCase()] = {
    version: TERMS_VERSION,
    acceptedAt: Date.now(),
  };
  safeWrite(map);
}

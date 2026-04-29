/**
 * Cookie / analytics consent. EU compliance demands an explicit opt-in
 * before any non-essential tracking initializes — PostHog (PR E) reads
 * `getCookieConsent()` at boot and short-circuits initialization when
 * the result isn't `accepted`.
 *
 * Storage key versioned ("v1") so future schema changes (e.g. granular
 * consent for analytics-vs-marketing) can migrate without colliding.
 */
export type CookieConsentStatus = "unset" | "accepted" | "rejected";

const STORAGE_KEY = "pp.cookie.consent.v1";

function safeRead(): CookieConsentStatus {
  if (typeof window === "undefined") return "unset";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "accepted" || v === "rejected") return v;
    return "unset";
  } catch {
    return "unset";
  }
}

function safeWrite(status: CookieConsentStatus): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, status);
  } catch {
    /* quota / disabled — fail silently */
  }
}

export function getCookieConsent(): CookieConsentStatus {
  return safeRead();
}

export function setCookieConsent(status: Exclude<CookieConsentStatus, "unset">): void {
  safeWrite(status);
}

/** True iff the user has explicitly opted in to non-essential cookies /
 *  analytics. Use as the gate for PostHog / similar SDKs. */
export function hasAnalyticsConsent(): boolean {
  return getCookieConsent() === "accepted";
}

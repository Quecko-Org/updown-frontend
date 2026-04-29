/**
 * Geo-blocking — client-side check.
 *
 * v1 strategy: free ipapi.co lookup on mount, country code stored in an
 * atom, UI gates wallet-connect + trade-submit on the result. Wide-open
 * (`status === "unknown"`) is treated as ALLOWED — better to err toward
 * usability when the lookup fails than lock everyone out.
 *
 * Production hardening (post-launch P0): migrate to a Next.js middleware
 * that reads the `CloudFront-Viewer-Country` header set by the dev /
 * prod CloudFront distribution. That moves the check to the edge,
 * costs nothing extra, and survives client-side bypass. The atom
 * surface here stays the same — only the source changes.
 *
 * Restricted-list: lawyer will populate the real values before mainnet
 * launch. The default below is a PLACEHOLDER for QA — verify the gate
 * fires by spoofing your country in DevTools (or run with
 * NEXT_PUBLIC_RESTRICTED_COUNTRIES set to your actual country code).
 */

/** ISO-3166-1 alpha-2 country codes that block the app. Placeholder
 *  values — real list comes from legal review. */
export const DEFAULT_RESTRICTED_COUNTRIES: readonly string[] = [
  "US", // United States
  "GB", // United Kingdom
  "IR", // Iran
  "KP", // North Korea
  "SY", // Syria
  "CU", // Cuba
];

/** Override via `NEXT_PUBLIC_RESTRICTED_COUNTRIES=US,GB,IR,...` in .env. */
export function loadRestrictedCountries(): readonly string[] {
  const raw =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_RESTRICTED_COUNTRIES?.trim()
      : "";
  if (raw && raw.length > 0) {
    return raw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z]{2}$/.test(s));
  }
  return DEFAULT_RESTRICTED_COUNTRIES;
}

/** Lookup result. `country` is null when the upstream lookup failed. */
export type GeoLookupResult = {
  country: string | null;
  source: "ipapi" | "fallback" | "error";
};

/**
 * Hit ipapi.co's free tier (no API key, 1k req/day/IP — generous enough
 * for once-per-session). Times out after 4s so a slow upstream can't
 * delay app render forever.
 */
export async function fetchClientCountry(
  signal?: AbortSignal,
): Promise<GeoLookupResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const composite = signal
      ? combineSignals(signal, controller.signal)
      : controller.signal;
    const res = await fetch("https://ipapi.co/json/", { signal: composite });
    clearTimeout(timeout);
    if (!res.ok) return { country: null, source: "error" };
    const data = (await res.json()) as { country_code?: string };
    const code = (data.country_code ?? "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return { country: null, source: "error" };
    return { country: code, source: "ipapi" };
  } catch {
    return { country: null, source: "error" };
  }
}

/** Cross-browser AbortSignal merge (drop when AbortSignal.any is universal). */
function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (a.aborted || b.aborted) ctrl.abort();
  else {
    a.addEventListener("abort", onAbort, { once: true });
    b.addEventListener("abort", onAbort, { once: true });
  }
  return ctrl.signal;
}

export function isCountryRestricted(
  country: string | null,
  list: readonly string[] = loadRestrictedCountries(),
): boolean {
  if (!country) return false;
  return list.includes(country.toUpperCase());
}

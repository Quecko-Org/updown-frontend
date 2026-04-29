/**
 * Geo-blocking — shared constants + client-side fallback.
 *
 * Production strategy: `middleware.ts` reads the
 * `CloudFront-Viewer-Country` header and 451-blocks restricted countries
 * at the edge before the SPA loads. For non-restricted visitors the
 * middleware also stamps a `pp-country` cookie that `useGeoCheck` reads
 * on hydration, so no client-side lookup is needed in production.
 *
 * `fetchClientCountry` (ipapi.co) remains as a belt for environments
 * where the header isn't present — local dev, preview deploys, or any
 * non-CloudFront origin. `unknown` (lookup failed) is still treated as
 * ALLOWED so a transient ipapi outage doesn't lock everyone out.
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

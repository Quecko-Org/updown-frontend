"use client";

import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { geoStateAtom } from "@/store/atoms";
import { fetchClientCountry, isCountryRestricted, isGeoGateEnabled } from "@/lib/geo";

/**
 * Resolve the visitor's country and write the result to `geoStateAtom`.
 *
 * Sources, in order of preference:
 *
 *   1. The `pp-country` cookie set by `middleware.ts` from the
 *      `CloudFront-Viewer-Country` header. This is the authoritative
 *      source in production — middleware already 451-blocks restricted
 *      countries before the SPA loads, so reaching here means non-
 *      restricted, but we still record the country so other UI can use
 *      it.
 *   2. Client-side ipapi.co lookup. Belt-and-suspenders for environments
 *      where the header isn't forwarded (local dev, preview deploys).
 *
 * If both fail, the atom transitions to `unknown` (allowed by default —
 * see lib/geo.ts for the rationale).
 */
function readCountryCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)pp-country=([A-Za-z]{2})/);
  if (!match) return null;
  return match[1].toUpperCase();
}

export function useGeoCheck(): void {
  const setGeo = useSetAtom(geoStateAtom);

  useEffect(() => {
    // Geo gate disabled (empty restricted list, e.g.
    // NEXT_PUBLIC_RESTRICTED_COUNTRIES="NONE"): allow immediately and skip the
    // ipapi.co probe entirely — no network request, no CORS console noise on
    // non-CloudFront origins where the probe would otherwise always run.
    if (!isGeoGateEnabled()) {
      setGeo({ status: "allowed", country: null });
      return;
    }

    const fromCookie = readCountryCookie();
    if (fromCookie) {
      setGeo({
        status: isCountryRestricted(fromCookie) ? "restricted" : "allowed",
        country: fromCookie,
      });
      return;
    }

    const ctrl = new AbortController();
    (async () => {
      const result = await fetchClientCountry(ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (result.country == null) {
        setGeo({ status: "unknown", country: null });
        return;
      }
      const restricted = isCountryRestricted(result.country);
      setGeo({
        status: restricted ? "restricted" : "allowed",
        country: result.country,
      });
    })();
    return () => ctrl.abort();
    // setGeo identity is stable per Jotai docs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

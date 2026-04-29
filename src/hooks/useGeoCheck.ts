"use client";

import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { geoStateAtom } from "@/store/atoms";
import { fetchClientCountry, isCountryRestricted } from "@/lib/geo";

/**
 * Resolve the visitor's country once on mount and write the result to
 * `geoStateAtom`. Other components read the atom to gate UI (connect
 * button, trade submit, restricted overlay).
 *
 * Lookup is fire-and-forget — if the upstream is slow / down, the atom
 * stays in `loading` for ~4s, then transitions to `unknown` (allowed by
 * default — see lib/geo.ts comment for production hardening rationale).
 */
export function useGeoCheck(): void {
  const setGeo = useSetAtom(geoStateAtom);

  useEffect(() => {
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
    // setGeo identity is stable per Jotai docs — empty deps is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

import { afterEach, describe, expect, it } from "vitest";
import {
  isCountryRestricted,
  isGeoGateEnabled,
  loadRestrictedCountries,
  DEFAULT_RESTRICTED_COUNTRIES,
} from "./geo";

describe("isCountryRestricted", () => {
  it("returns false for null country (lookup failure)", () => {
    expect(isCountryRestricted(null)).toBe(false);
  });

  it("returns false for an unrestricted country", () => {
    expect(isCountryRestricted("FR")).toBe(false);
  });

  it("matches the default placeholder list case-insensitively", () => {
    for (const code of DEFAULT_RESTRICTED_COUNTRIES) {
      expect(isCountryRestricted(code)).toBe(true);
      expect(isCountryRestricted(code.toLowerCase())).toBe(true);
    }
  });

  it("respects a caller-supplied list", () => {
    expect(isCountryRestricted("FR", ["FR"])).toBe(true);
    expect(isCountryRestricted("US", ["FR"])).toBe(false);
  });

  it("ignores empty list", () => {
    expect(isCountryRestricted("US", [])).toBe(false);
  });
});

describe("loadRestrictedCountries — NONE sentinel", () => {
  const KEY = "NEXT_PUBLIC_RESTRICTED_COUNTRIES";
  const original = process.env[KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('empties the restricted list when set to "NONE" (case-insensitive, trimmed)', () => {
    for (const v of ["NONE", "none", "None", "  none  "]) {
      process.env[KEY] = v;
      expect(loadRestrictedCountries()).toEqual([]);
    }
  });

  it("falls back to the placeholder default when unset or blank", () => {
    delete process.env[KEY];
    expect(loadRestrictedCountries()).toEqual([...DEFAULT_RESTRICTED_COUNTRIES]);
    process.env[KEY] = "   ";
    expect(loadRestrictedCountries()).toEqual([...DEFAULT_RESTRICTED_COUNTRIES]);
  });

  it("parses an explicit comma-separated override (upper-cased, 2-letter only)", () => {
    process.env[KEY] = "us, fr ,zz1,DE";
    expect(loadRestrictedCountries()).toEqual(["US", "FR", "DE"]);
  });
});

describe("isGeoGateEnabled — probe-skip guard", () => {
  it("is false for an empty list → useGeoCheck allows immediately and skips the ipapi probe", () => {
    expect(isGeoGateEnabled([])).toBe(false);
  });

  it("is true when the list has entries → the cookie/probe path runs", () => {
    expect(isGeoGateEnabled(["US"])).toBe(true);
    expect(isGeoGateEnabled(DEFAULT_RESTRICTED_COUNTRIES)).toBe(true);
  });

  it('treats the "NONE" sentinel as gate-disabled end to end', () => {
    const KEY = "NEXT_PUBLIC_RESTRICTED_COUNTRIES";
    const original = process.env[KEY];
    process.env[KEY] = "NONE";
    try {
      expect(isGeoGateEnabled()).toBe(false);
      // Allow-all: even a placeholder-listed country resolves as unrestricted.
      expect(isCountryRestricted("US", loadRestrictedCountries())).toBe(false);
    } finally {
      if (original === undefined) delete process.env[KEY];
      else process.env[KEY] = original;
    }
  });
});

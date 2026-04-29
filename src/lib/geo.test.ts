import { describe, expect, it } from "vitest";
import { isCountryRestricted, DEFAULT_RESTRICTED_COUNTRIES } from "./geo";

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

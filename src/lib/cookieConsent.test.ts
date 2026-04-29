import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCookieConsent,
  hasAnalyticsConsent,
  setCookieConsent,
} from "./cookieConsent";

describe("cookieConsent", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts unset", () => {
    expect(getCookieConsent()).toBe("unset");
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it("records and reads accepted", () => {
    setCookieConsent("accepted");
    expect(getCookieConsent()).toBe("accepted");
    expect(hasAnalyticsConsent()).toBe(true);
  });

  it("records and reads rejected", () => {
    setCookieConsent("rejected");
    expect(getCookieConsent()).toBe("rejected");
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it("ignores invalid stored values", () => {
    window.localStorage.setItem("pp.cookie.consent.v1", "garbage");
    expect(getCookieConsent()).toBe("unset");
  });
});

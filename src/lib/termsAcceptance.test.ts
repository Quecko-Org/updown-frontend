import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TERMS_VERSION,
  acceptCurrentVersion,
  getAcceptedVersion,
  hasAcceptedCurrentVersion,
} from "./termsAcceptance";

describe("termsAcceptance", () => {
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts unaccepted", () => {
    expect(getAcceptedVersion("0xabc")).toBeNull();
    expect(hasAcceptedCurrentVersion("0xabc")).toBe(false);
  });

  it("records acceptance for the current version", () => {
    acceptCurrentVersion("0xabc");
    expect(getAcceptedVersion("0xabc")).toBe(TERMS_VERSION);
    expect(hasAcceptedCurrentVersion("0xabc")).toBe(true);
  });

  it("treats wallet keys case-insensitively", () => {
    acceptCurrentVersion("0xABC");
    expect(hasAcceptedCurrentVersion("0xabc")).toBe(true);
  });

  it("isolates wallets — one accepts, another stays unaccepted", () => {
    acceptCurrentVersion("0xabc");
    expect(hasAcceptedCurrentVersion("0xabc")).toBe(true);
    expect(hasAcceptedCurrentVersion("0xdef")).toBe(false);
  });

  it("survives malformed storage payloads", () => {
    window.localStorage.setItem("pp.terms.accepted.v1", "{not valid json");
    expect(getAcceptedVersion("0xabc")).toBeNull();
    acceptCurrentVersion("0xabc");
    expect(hasAcceptedCurrentVersion("0xabc")).toBe(true);
  });

  it("rejects non-object storage payloads", () => {
    window.localStorage.setItem("pp.terms.accepted.v1", JSON.stringify(["array"]));
    expect(getAcceptedVersion("0xabc")).toBeNull();
  });
});

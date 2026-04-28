import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBookmarkedMarkets, isBookmarked, toggleBookmark } from "./bookmarks";

describe("bookmarks", () => {
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

  it("starts empty", () => {
    expect(getBookmarkedMarkets()).toEqual([]);
    expect(isBookmarked("0xabc-1")).toBe(false);
  });

  it("toggles a market on then off", () => {
    expect(toggleBookmark("0xabc-1")).toBe(true);
    expect(isBookmarked("0xabc-1")).toBe(true);
    expect(getBookmarkedMarkets()).toEqual(["0xabc-1"]);
    expect(toggleBookmark("0xabc-1")).toBe(false);
    expect(isBookmarked("0xabc-1")).toBe(false);
  });

  it("treats keys case-insensitively", () => {
    toggleBookmark("0xABC-1");
    expect(isBookmarked("0xabc-1")).toBe(true);
    expect(toggleBookmark("0xabc-1")).toBe(false);
  });

  it("survives malformed storage payload", () => {
    window.localStorage.setItem("pp.bookmarks.v1", "{not valid json");
    expect(getBookmarkedMarkets()).toEqual([]);
    expect(toggleBookmark("0xabc-1")).toBe(true);
    expect(getBookmarkedMarkets()).toEqual(["0xabc-1"]);
  });
});

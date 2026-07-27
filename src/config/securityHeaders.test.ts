import { describe, it, expect } from "vitest";
import nextConfig from "../../next.config";

/**
 * Pins the security-header contract served by next.config.ts.
 *
 * These assert the INVARIANTS (a header is present and carries the meaning we
 * intended), not the literal config shape — with one exception that is itself an
 * invariant: the rule must apply to `_next/` assets. That is the whole reason these
 * headers live in next.config.ts rather than middleware.ts, whose matcher excludes
 * `_next/` and would therefore leave every JS and CSS asset unprotected.
 */

async function resolveHeaderRules() {
  expect(nextConfig.headers, "next.config.ts must declare headers()").toBeTypeOf(
    "function"
  );
  return await nextConfig.headers!();
}

async function headerMap(): Promise<Map<string, string>> {
  const rules = await resolveHeaderRules();
  const catchAll = rules[0];
  return new Map(catchAll.headers.map((h) => [h.key.toLowerCase(), h.value]));
}

describe("security headers", () => {
  it("applies to every path, including _next/ assets", async () => {
    const rules = await resolveHeaderRules();
    expect(rules).toHaveLength(1);

    const { source } = rules[0];
    // A negative lookahead is precisely how middleware.ts carves out `_next/`.
    // If one ever appears here, JS/CSS assets silently lose their headers.
    expect(source).not.toContain("(?!");
    // Catch-all from the root: anything else would leave routes uncovered.
    expect(source).toBe("/:path*");
  });

  it("blocks MIME sniffing", async () => {
    expect((await headerMap()).get("x-content-type-options")).toBe("nosniff");
  });

  it("does not leak full URLs cross-origin via Referer", async () => {
    const policy = (await headerMap()).get("referrer-policy");
    // Any policy that sends the path cross-origin defeats the point.
    expect(policy).not.toBe("unsafe-url");
    expect(policy).not.toBe("no-referrer-when-downgrade");
    expect(policy).toBe("strict-origin-when-cross-origin");
  });

  it("refuses to be framed", async () => {
    // SAMEORIGIN would still be defensible if an embed were planned; ALLOW-ALL /
    // absent is not. The rain.trade integration is an SDK, so DENY is correct.
    expect((await headerMap()).get("x-frame-options")).toBe("DENY");
  });

  describe("HSTS", () => {
    it("asserts HTTPS for at least a year", async () => {
      const hsts = (await headerMap()).get("strict-transport-security");
      expect(hsts).toBeDefined();
      const maxAge = Number(/max-age=(\d+)/.exec(hsts!)?.[1]);
      expect(maxAge).toBeGreaterThanOrEqual(31536000);
    });

    it("does not reach sibling hosts or the preload list", async () => {
      const hsts = (await headerMap()).get("strict-transport-security")!;
      // These apps sit on hosts under rainwins.com alongside siblings this
      // deployment does not own; includeSubDomains would force HTTPS on all of
      // them, and preload makes that effectively irreversible.
      expect(hsts).not.toMatch(/includeSubDomains/i);
      expect(hsts).not.toMatch(/preload/i);
    });
  });

  it("ships no ENFORCING Content-Security-Policy", async () => {
    const headers = await headerMap();
    // An enforcing CSP cannot be written from source: the origin list is provably
    // incomplete (Account Kit reaches api.segment.io transitively; wagmi's bare
    // http() for mainnet resolves to a viem built-in default that moves on patch
    // bumps), and a missed connect-src origin kills wallet connect with no
    // graceful degradation. Report-Only is permitted and is the required first
    // step; enforcement must be earned with a real report-collection period.
    expect(headers.has("content-security-policy")).toBe(false);
  });
});

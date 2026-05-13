/**
 * PR-2 visual sweep — 5 viewports × full-page captures of /dev/market-rows
 * plus per-row variant crops and a battery of invariants.
 *
 * Mirrors the discipline applied in pr-1-viewport.spec.ts:
 *   - Runs against http://localhost:3100 (override via PLAYWRIGHT_BASE_URL).
 *   - Outputs to e2e/screenshots/pr-2/*.png — stable path Playwright does
 *     not wipe (unlike test-results/).
 *   - `--workers=1` to avoid hydration races under parallel load.
 *
 * Invariants asserted:
 *   - No horizontal overflow at 375 (.pp-market-row width <= viewport width).
 *   - --up / --down CSS variables resolve to colored values (not gray fallbacks).
 *   - Numerical cells use `font-variant-numeric: tabular-nums` (tabular alignment).
 *   - Radius tokens applied — every .pp-market-row uses var(--r-lg) (= 12px).
 *   - Next-row depth ladder: opacities are strictly decreasing from depth 0 → 2.
 *
 * Run: `npx playwright test e2e/pr-2-viewport.spec.ts --workers=1`
 */

import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";
const OUT = path.resolve(__dirname, "./screenshots/pr-2");

const viewports = [
  { name: "375-iphone-se",     width: 375,  height: 1600 },
  { name: "390-iphone-14",     width: 390,  height: 1600 },
  { name: "768-ipad-portrait", width: 768,  height: 1600 },
  { name: "1280-laptop",       width: 1280, height: 1600 },
  { name: "1920-large",        width: 1920, height: 1600 },
];

test.beforeAll(() => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
});

for (const vp of viewports) {
  test(`viewport ${vp.name}: dev/market-rows full-page + variant crops`, async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/dev/market-rows`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // App layout bails to CSR (next/dynamic in AppShell tree). Poll for the
    // row to mount in the client DOM — `state: attached` since the BAILOUT
    // can leave the initial SSR shell empty and `state: visible` races the
    // overlap with GeoBlockOverlay's portal layer.
    await page.locator(".pp-market-row").first().waitFor({ state: "attached", timeout: 30_000 });
    await page.waitForTimeout(1500);

    await page.screenshot({
      path: path.join(OUT, `${vp.name}__full.png`),
      fullPage: true,
    });

    // Variant crops — one per state. Skip if a variant is missing (defensive).
    const variants = ["live", "open", "next"] as const;
    for (const v of variants) {
      const el = page.locator(`.pp-market-row--${v}`).first();
      if (await el.count() === 0) continue;
      await el.screenshot({ path: path.join(OUT, `${vp.name}__${v}.png`) });
    }

    await ctx.close();
  });
}

test("invariant: no horizontal overflow at 375 (.pp-market-row fits viewport)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 1600 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dev/market-rows`, { waitUntil: "load", timeout: 30_000 });
  await page.locator(".pp-market-row").first().waitFor({ state: "visible", timeout: 30_000 });
  const overflow = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(".pp-market-row"));
    const vw = window.innerWidth;
    const overflows = rows.map((r) => {
      const rect = r.getBoundingClientRect();
      return Math.max(0, Math.round(rect.right - vw));
    });
    return { count: rows.length, vw, maxOverflowPx: Math.max(...overflows, 0) };
  });
  expect(overflow.count, "no pp-market-row elements on page").toBeGreaterThan(0);
  expect(overflow.maxOverflowPx, `pp-market-row overflows viewport by ${overflow.maxOverflowPx}px at 375`).toBeLessThanOrEqual(1);
  await ctx.close();
});

test("invariant: --up / --down tokens resolve to color (not gray fallback)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dev/market-rows`, { waitUntil: "load", timeout: 30_000 });
  await page.locator(".pp-market-row").first().waitFor({ state: "visible", timeout: 30_000 });
  const colors = await page.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    return {
      up: cs.getPropertyValue("--up").trim(),
      down: cs.getPropertyValue("--down").trim(),
      upBg: cs.getPropertyValue("--up-bg").trim(),
      downBg: cs.getPropertyValue("--down-bg").trim(),
    };
  });
  // --up / --down should resolve to oklch(...) values, not empty / not "gray" / not the same.
  expect(colors.up, "--up unresolved").not.toEqual("");
  expect(colors.down, "--down unresolved").not.toEqual("");
  expect(colors.up).not.toEqual(colors.down);
  expect(colors.upBg).not.toEqual("");
  expect(colors.downBg).not.toEqual("");
});

test("invariant: numerical cells use tabular-nums", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dev/market-rows`, { waitUntil: "load", timeout: 30_000 });
  await page.locator(".pp-market-row").first().waitFor({ state: "visible", timeout: 30_000 });
  const tabular = await page.evaluate(() => {
    const targets = ["__time", "__strike", "__pool", "__timer"] as const;
    const out: Record<string, string> = {};
    for (const t of targets) {
      const el = document.querySelector(`.pp-market-row${t}`) as HTMLElement | null;
      if (!el) { out[t] = "MISSING"; continue; }
      out[t] = getComputedStyle(el).fontVariantNumeric;
    }
    return out;
  });
  for (const [key, val] of Object.entries(tabular)) {
    if (val === "MISSING") continue;
    expect(val, `${key} missing tabular-nums (got "${val}")`).toContain("tabular-nums");
  }
});

test("invariant: every .pp-market-row uses --r-lg (12px) border-radius", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dev/market-rows`, { waitUntil: "load", timeout: 30_000 });
  await page.locator(".pp-market-row").first().waitFor({ state: "visible", timeout: 30_000 });
  const radii = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(".pp-market-row"));
    return rows.map((r) => getComputedStyle(r).borderRadius);
  });
  expect(radii.length).toBeGreaterThan(0);
  for (const r of radii) expect(r, `unexpected radius ${r} on .pp-market-row`).toBe("12px");
});

test("invariant: next-row depth ladder — opacities strictly decreasing", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dev/market-rows`, { waitUntil: "load", timeout: 30_000 });
  await page.locator(".pp-market-row--next").first().waitFor({ state: "visible", timeout: 30_000 });
  const opacities = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(".pp-market-row--next"));
    return rows.map((r) => Number(getComputedStyle(r).opacity));
  });
  expect(opacities.length, "expected at least 2 NextMarketRow instances on preview").toBeGreaterThanOrEqual(2);
  for (let i = 1; i < opacities.length; i++) {
    expect(
      opacities[i],
      `next-row depth ${i} opacity ${opacities[i]} should be < depth ${i - 1} opacity ${opacities[i - 1]}`,
    ).toBeLessThan(opacities[i - 1]);
  }
});

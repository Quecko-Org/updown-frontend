/**
 * PR-1 visual regression spec — 5 viewports × 2 captures = 10 screenshots.
 * Captures: (a) header detail, (b) header with hamburger dropdown open.
 *
 * Runs against the local dev server at http://localhost:3100 (override via
 * PLAYWRIGHT_BASE_URL). Outputs to e2e/screenshots/pr-1/*.png — a stable
 * path Playwright does not wipe between runs (it auto-cleans test-results/).
 *
 * Use `load` not `networkidle` — the dev page keeps WebSocket connections
 * open + Coinbase aggregator + frequent React Query refetches, so
 * networkidle never settles within the 30s test timeout.
 *
 * Run: `npx playwright test e2e/pr-1-viewport.spec.ts --reporter=line`
 */

import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";
const OUT = path.resolve(__dirname, "./screenshots/pr-1");

const viewports = [
  { name: "375-iphone-se",   width: 375,  height: 667 },
  { name: "390-iphone-14",   width: 390,  height: 844 },
  { name: "768-ipad-portrait", width: 768, height: 1024 },
  { name: "1280-laptop",     width: 1280, height: 800 },
  { name: "1920-large",      width: 1920, height: 1080 },
];

test.beforeAll(() => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
});

for (const vp of viewports) {
  test(`viewport ${vp.name}: header + hamburger captures`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: "load", timeout: 30_000 });
    // Wait for the shiny CTA to mount (the connect-wallet pill is the canary —
    // its presence proves hydration completed at this viewport width).
    await page.locator(".pp-shiny-cta").first().waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(400);

    const header = page.locator("header").first();
    await header.waitFor({ state: "visible", timeout: 10_000 });
    await header.screenshot({ path: path.join(OUT, `${vp.name}__header.png`) });

    const hamburger = page.locator(
      'header button:has(svg.lucide-menu), header button[aria-label*="enu" i]'
    ).first();
    if (await hamburger.count() > 0) {
      await hamburger.click();
      await page.waitForTimeout(400);
      const cropHeight = Math.min(vp.height, 320);
      await page.screenshot({
        path: path.join(OUT, `${vp.name}__header-hamburger-open.png`),
        clip: { x: 0, y: 0, width: vp.width, height: cropHeight },
      });
    }

    await ctx.close();
  });
}

test("invariant: header right cluster fits at 375 (no horizontal overflow)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load", timeout: 20_000 });
  await page.waitForTimeout(800);
  const overflow = await page.evaluate(() => {
    const right = document.querySelector(".pp-hdr__right") as HTMLElement | null;
    if (!right) return { error: "no .pp-hdr__right" };
    const r = right.getBoundingClientRect();
    return { right: Math.round(r.right), viewport: window.innerWidth, overflowPx: Math.max(0, Math.round(r.right - window.innerWidth)) };
  });
  expect((overflow as { overflowPx?: number }).overflowPx ?? 999).toBeLessThanOrEqual(1);
  await ctx.close();
});

test("invariant: shiny CTA renders single-line (height < 50px) at every viewport", async ({ browser }) => {
  test.setTimeout(120_000);
  for (const vp of viewports) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: "load", timeout: 30_000 });
    // Hydration under parallel-worker load can lag — wait generously, the
    // page-level capture tests already prove the element renders at this width.
    await page.locator(".pp-shiny-cta").first().waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(400);
    const shinyDims = await page.evaluate(() => {
      const el = document.querySelector(".pp-shiny-cta") as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    expect(shinyDims, `${vp.name}: .pp-shiny-cta missing`).not.toBeNull();
    expect(shinyDims!.h, `${vp.name}: shiny CTA height ${shinyDims!.h}px > 50 (likely 2-line wrap)`).toBeLessThan(50);
    await ctx.close();
  }
});

test("invariant: radius tokens applied (sm=4, md=8, lg=12)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load", timeout: 20_000 });
  await page.waitForTimeout(800);
  const radii = await page.evaluate(() => {
    const sty = document.createElement("style");
    sty.textContent = ".pr1-sm{border-radius:var(--r-sm)}.pr1-md{border-radius:var(--r-md)}.pr1-lg{border-radius:var(--r-lg)}";
    document.head.appendChild(sty);
    const mk = (cls: string) => {
      const d = document.createElement("div");
      d.className = cls;
      document.body.appendChild(d);
      const r = getComputedStyle(d).borderRadius;
      d.remove();
      return r;
    };
    return { sm: mk("pr1-sm"), md: mk("pr1-md"), lg: mk("pr1-lg") };
  });
  expect(radii.sm).toBe("4px");
  expect(radii.md).toBe("8px");
  expect(radii.lg).toBe("12px");
  await ctx.close();
});

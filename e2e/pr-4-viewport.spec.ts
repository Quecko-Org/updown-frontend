/**
 * PR-4 visual sweep — 5 viewports of the new design, plus
 * state-ladder branch captures, the trade drawer at mobile + desktop
 * breakpoints, and the back-button acceptance test from the
 * navigation-friction fix.
 *
 * Carries forward PR-3's diagnostic discipline (attachErrorWatch
 * captures console + pageerror + 4xx/5xx with documented benign
 * allowlist) and adds two PR-4-specific things:
 *   - Back-button acceptance test: from /portfolio with a stashed
 *     last-market view, clicking ← Markets restores ?asset=X&tf=Y
 *   - Radius invariant updated to assert 24px (--r-xl) on rows + cards
 *     since commit 8/10 migrated them off --r-lg
 *
 * Run: `npx playwright test e2e/pr-4-viewport.spec.ts --workers=1`
 */

import { test, expect, type ConsoleMessage } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";
const OUT = path.resolve(__dirname, "./screenshots/pr-4-after");

const viewports = [
  { name: "375-iphone-se",     width: 375,  height: 2200 },
  { name: "390-iphone-14",     width: 390,  height: 2200 },
  { name: "768-ipad-portrait", width: 768,  height: 2200 },
  { name: "1280-laptop",       width: 1280, height: 2000 },
  { name: "1920-large",        width: 1920, height: 2000 },
];

test.beforeAll(() => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
});

function attachErrorWatch(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  const benign = [
    /WebSocket .* failed/i,
    /Failed to load resource.*favicon/i,
    /Download the React DevTools/i,
    /Skipping auto-scroll/i,
    /\[Fast Refresh\]/i,
    /ipapi\.co/i,
    /Access to fetch .* has been blocked by CORS/i,
    /net::ERR_FAILED/i,
    /Lit is in dev mode/i,
    /\/markets\/[^/]+\/prices/i,
    /Failed to load resource.*404/i,
    /pulsepairs-wordmark-dark\.svg/i,
  ];
  const filterText = (t: string) => !benign.some((re) => re.test(t));

  page.on("console", (m: ConsoleMessage) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const text = m.text();
    if (!filterText(text)) return;
    errors.push(`[console.${m.type()}] ${text}`);
  });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  page.on("response", (resp) => {
    const status = resp.status();
    if (status < 400) return;
    const url = resp.url();
    if (benign.some((re) => re.test(url))) return;
    errors.push(`[response ${status}] ${url}`);
  });
  return errors;
}

async function gotoAndWait(page: import("@playwright/test").Page, urlPath: string) {
  await page.goto(`${BASE}${urlPath}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator("main.pp-markets-page").first().waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForTimeout(2000);
}

for (const vp of viewports) {
  test(`after ${vp.name}: full-page happy path`, async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    const errors = attachErrorWatch(page);
    await gotoAndWait(page, "/");
    expect(errors, `console/pageerror: ${errors.join(" | ")}`).toEqual([]);
    await page.screenshot({ path: path.join(OUT, `${vp.name}__full.png`), fullPage: true });
    await ctx.close();
  });
}

test("acceptance: back-button restores last-viewed market", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const page = await ctx.newPage();
  attachErrorWatch(page);
  // 1. Visit / with explicit ETH 60m so useTrackLastMarketView stashes it.
  await gotoAndWait(page, "/?asset=eth&timeframe=60m");
  // 2. Navigate to /portfolio. Back button + restored logo href should appear.
  await page.goto(`${BASE}/portfolio`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(".pp-hdr__back").waitFor({ state: "visible", timeout: 15_000 });
  // 3. Click the back button.
  await page.locator(".pp-hdr__back").click();
  await page.waitForURL(/\/\?asset=eth&timeframe=60m/, { timeout: 15_000 });
  // 4. Verify the markets page restored the exact view.
  const url = page.url();
  expect(url).toContain("asset=eth");
  expect(url).toContain("timeframe=60m");
  await ctx.close();
});

test("invariant: rows + cards use --r-xl (24px) per PR-4 consumer tier", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
  const page = await ctx.newPage();
  attachErrorWatch(page);
  await gotoAndWait(page, "/?asset=btc&timeframe=5m");
  const radii = await page.evaluate(() => {
    const samples = Array.from(
      document.querySelectorAll<HTMLElement>(".pp-market-row, .pp-state-card, .pp-row-skeleton"),
    );
    return samples.map((el) => ({
      cls: el.className,
      radius: getComputedStyle(el).borderRadius,
    }));
  });
  expect(radii.length, "expected at least one row/card on /").toBeGreaterThan(0);
  for (const { cls, radius } of radii) {
    expect(radius, `unexpected radius ${radius} on ${cls}`).toBe("24px");
  }
  await ctx.close();
});

test("invariant: --up-text / --down-text resolve and differ from --up / --down", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const page = await ctx.newPage();
  attachErrorWatch(page);
  await gotoAndWait(page, "/?asset=btc&timeframe=5m");
  const colors = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      up: cs.getPropertyValue("--up").trim(),
      upText: cs.getPropertyValue("--up-text").trim(),
      down: cs.getPropertyValue("--down").trim(),
      downText: cs.getPropertyValue("--down-text").trim(),
    };
  });
  expect(colors.up, "--up missing").not.toEqual("");
  expect(colors.upText, "--up-text missing").not.toEqual("");
  expect(colors.upText, "--up-text should differ from --up").not.toEqual(colors.up);
  expect(colors.down, "--down missing").not.toEqual("");
  expect(colors.downText, "--down-text missing").not.toEqual("");
  expect(colors.downText, "--down-text should differ from --down").not.toEqual(colors.down);
  await ctx.close();
});

test("invariant: page bg uses radial gradient (background-image present)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const page = await ctx.newPage();
  attachErrorWatch(page);
  await gotoAndWait(page, "/?asset=btc&timeframe=5m");
  const bg = await page.evaluate(() => {
    return getComputedStyle(document.body).backgroundImage;
  });
  expect(bg, "body background-image should be a radial-gradient, got: " + bg).toMatch(/radial-gradient/);
  await ctx.close();
});

test("invariant: shiny CTA ::after opacity is 0.6 (Myriad-parity depth)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const page = await ctx.newPage();
  attachErrorWatch(page);
  await gotoAndWait(page, "/?asset=btc&timeframe=5m");
  const opacity = await page.evaluate(() => {
    const el = document.querySelector(".pp-shiny-cta");
    if (!el) return null;
    const cs = getComputedStyle(el, "::after");
    return cs.opacity;
  });
  expect(opacity, "no pp-shiny-cta on /").not.toBeNull();
  expect(parseFloat(opacity as string)).toBeCloseTo(0.6, 1);
  await ctx.close();
});

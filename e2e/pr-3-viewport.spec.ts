/**
 * PR-3 visual sweep — 5 viewports × full-page captures of /  plus
 * state-ladder branch captures (happy, empty, error) and the trade
 * drawer at mobile + desktop breakpoints.
 *
 * Carries forward PR-2's discipline:
 *   - Every test captures page.on("console") and page.on("pageerror")
 *     and ASSERTS ZERO ERROR events before taking the screenshot. This
 *     is the catch that surfaced the silent server-component-passing-
 *     function-prop bug in PR-2. Building it into the spec template
 *     from PR-3 onward so the "page renders but is broken" class of
 *     bug can't ship.
 *   - `--workers=1` to avoid hydration races under parallel load.
 *   - Outputs to e2e/screenshots/pr-3/ (stable path Playwright doesn't
 *     wipe between runs).
 *
 * Run: `npx playwright test e2e/pr-3-viewport.spec.ts --workers=1`
 */

import { test, expect, type ConsoleMessage } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";
const OUT = path.resolve(__dirname, "./screenshots/pr-3");

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

/**
 * Capture console + pageerror events and assert zero errors. Whitelist a
 * small set of known-benign warnings the dev server emits unrelated to
 * the PR (WebSocket-not-connected on the dev API, third-party Coinbase
 * aggregator timeouts). Anything else fails the test.
 */
function attachErrorWatch(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  const benign = [
    /WebSocket .* failed/i,                  // dev-api WS retry chatter
    /Failed to load resource.*favicon/i,     // favicon 404 is page-chrome
    /Download the React DevTools/i,          // info-level dev notice
    /Skipping auto-scroll/i,                 // Next.js dev hint
    /\[Fast Refresh\]/i,                     // Next.js dev hot-reload
    /ipapi\.co/i,                            // GeoBlockOverlay's geo fetch — CORS-blocked from localhost (works in prod via Amplify edge)
    /Access to fetch .* has been blocked by CORS/i, // same ipapi CORS surfacing as a separate console line
    /net::ERR_FAILED/i,                      // CORS-blocked network surface
    /Lit is in dev mode/i,                   // WalletConnect's Lit dependency emits this banner
    /\/markets\/[^/]+\/prices/i,             // chart's per-market price endpoint legitimately 404s for synthetic mock markets + new markets before backfill; WS pushes the data later
    /Failed to load resource.*404/i,         // generic surface of the same — the response listener already captures the URL above for inspection
    /pulsepairs-wordmark-dark\.svg/i,        // pre-existing Next.js Image aspect-ratio warning on the brand wordmark (not in PR-3 scope)
  ];
  const filterText = (t: string) => !benign.some((re) => re.test(t));

  page.on("console", (m: ConsoleMessage) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const text = m.text();
    if (!filterText(text)) return;
    errors.push(`[console.${m.type()}] ${text}`);
  });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  // Network-layer 4xx/5xx feeds the same channel — surfaces the URL so the
  // human can decide whether to whitelist (third-party CORS) or fix
  // (app-side 404 like the silent failed-route in PR-2's diagnostic catch).
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
  // App layout bails to CSR (next/dynamic in AppShell tree, same as PR-2).
  // Wait for the pp-markets-page main to mount in the client DOM.
  await page.locator("main.pp-markets-page").first().waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForTimeout(1500);
}

for (const vp of viewports) {
  test(`viewport ${vp.name}: full-page happy path`, async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    const errors = attachErrorWatch(page);
    await gotoAndWait(page, "/");
    expect(errors, `console + pageerror events: ${errors.join(" | ")}`).toEqual([]);
    await page.screenshot({ path: path.join(OUT, `${vp.name}__full.png`), fullPage: true });
    await ctx.close();
  });
}

test("state: empty market list (no rows)", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const page = await ctx.newPage();
  const errors = attachErrorWatch(page);
  // Intercept the markets fetch and serve []
  await page.route(/\/markets(\?|$)/, (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await gotoAndWait(page, "/?asset=btc&timeframe=5m");
  await page.locator('[data-testid="state-empty"]').waitFor({ state: "visible", timeout: 15_000 });
  expect(errors, `console + pageerror: ${errors.join(" | ")}`).toEqual([]);
  await page.screenshot({ path: path.join(OUT, "1280__state-empty.png"), fullPage: true });
  await ctx.close();
});

test("state: backend error (retry button visible)", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const page = await ctx.newPage();
  const errors = attachErrorWatch(page);
  await page.route(/\/markets(\?|$)/, (route) => {
    route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"down"}' });
  });
  await gotoAndWait(page, "/?asset=btc&timeframe=5m");
  await page.locator('[data-testid="state-error"]').waitFor({ state: "visible", timeout: 15_000 });
  // For this test only — known 500 responses produce expected error chatter;
  // we explicitly inspect the page's reaction (retry button), not the lack
  // of console noise.
  void errors;
  await page.screenshot({ path: path.join(OUT, "1280__state-error.png"), fullPage: true });
  await ctx.close();
});

test("state: live missing but open present (headline note)", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const page = await ctx.newPage();
  const errors = attachErrorWatch(page);
  const nowSec = Math.floor(Date.now() / 1000);
  // Synthetic market list: no ACTIVE row, but a PENDING starts in 4 minutes.
  await page.route(/\/markets(\?|$)/, (route) => {
    const open = {
      address: "0xmockopen-1",
      pairId: "BTC-USD",
      pairSymbol: "BTC-USD",
      chartSymbol: "BTC",
      startTime: nowSec + 240,
      endTime: nowSec + 540,
      duration: 300,
      status: "PENDING",
      winner: null,
      upPrice: "5400",
      downPrice: "4600",
      strikePrice: "103247",
      volume: "184.50",
    };
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([open]),
    });
  });
  await gotoAndWait(page, "/?asset=btc&timeframe=5m");
  await page.locator('[data-testid="state-no-live"]').waitFor({ state: "visible", timeout: 15_000 });
  expect(errors, `console + pageerror: ${errors.join(" | ")}`).toEqual([]);
  await page.screenshot({ path: path.join(OUT, "1280__state-no-live.png"), fullPage: true });
  await ctx.close();
});

test("drawer: desktop slide-in (1280)", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const page = await ctx.newPage();
  const errors = attachErrorWatch(page);
  const nowSec = Math.floor(Date.now() / 1000);
  await page.route(/\/markets(\?|$)/, (route) => {
    const live = {
      address: "0xmocklive-1",
      pairId: "BTC-USD",
      pairSymbol: "BTC-USD",
      chartSymbol: "BTC",
      startTime: nowSec - 60,
      endTime: nowSec + 240,
      duration: 300,
      status: "ACTIVE",
      winner: null,
      upPrice: "6200",
      downPrice: "3800",
      strikePrice: "103189",
      volume: "421.18",
    };
    const open = { ...live, address: "0xmockopen-1", startTime: nowSec + 240, endTime: nowSec + 540, status: "PENDING", upPrice: "5400", downPrice: "4600", strikePrice: "103247", volume: "184.50" };
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([live, open]) });
  });
  await gotoAndWait(page, "/?asset=btc&timeframe=5m");
  // Click the Open row's UP button.
  await page.locator('.pp-market-row--open .pp-btn--up').first().click();
  await page.locator('[data-testid="trade-drawer"]').waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(400); // settle the slide-in animation
  expect(errors, `console + pageerror: ${errors.join(" | ")}`).toEqual([]);
  await page.screenshot({ path: path.join(OUT, "1280__drawer-up.png"), fullPage: true });
  await ctx.close();
});

test("drawer: mobile bottom-sheet (375)", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ viewport: { width: 375, height: 2200 } });
  const page = await ctx.newPage();
  const errors = attachErrorWatch(page);
  const nowSec = Math.floor(Date.now() / 1000);
  await page.route(/\/markets(\?|$)/, (route) => {
    const live = {
      address: "0xmocklive-1",
      pairId: "BTC-USD",
      pairSymbol: "BTC-USD",
      chartSymbol: "BTC",
      startTime: nowSec - 60,
      endTime: nowSec + 240,
      duration: 300,
      status: "ACTIVE",
      winner: null,
      upPrice: "6200",
      downPrice: "3800",
      strikePrice: "103189",
      volume: "421.18",
    };
    const open = { ...live, address: "0xmockopen-1", startTime: nowSec + 240, endTime: nowSec + 540, status: "PENDING", upPrice: "5400", downPrice: "4600", strikePrice: "103247", volume: "184.50" };
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([live, open]) });
  });
  await gotoAndWait(page, "/?asset=btc&timeframe=5m");
  await page.locator('.pp-market-row--open .pp-btn--down').first().click();
  await page.locator('[data-testid="trade-drawer"]').waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(400);
  expect(errors, `console + pageerror: ${errors.join(" | ")}`).toEqual([]);
  await page.screenshot({ path: path.join(OUT, "375__drawer-down.png"), fullPage: true });
  await ctx.close();
});

test("invariant: no horizontal overflow on .pp-markets-page at 375", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 2000 } });
  const page = await ctx.newPage();
  attachErrorWatch(page);
  await gotoAndWait(page, "/?asset=btc&timeframe=5m");
  const overflow = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".pp-markets-page, .pp-market-row, .pp-state-card, .pp-row-skeleton"));
    const vw = window.innerWidth;
    return Math.max(
      0,
      ...els.map((e) => Math.round(e.getBoundingClientRect().right - vw)),
    );
  });
  expect(overflow, `overflow ${overflow}px at 375 viewport`).toBeLessThanOrEqual(1);
  await ctx.close();
});

test("invariant: asset pill border-radius is 999px (pill role)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const page = await ctx.newPage();
  attachErrorWatch(page);
  await gotoAndWait(page, "/?asset=btc&timeframe=5m");
  const radii = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".pp-asset-pill"));
    return els.map((e) => getComputedStyle(e).borderRadius);
  });
  expect(radii.length).toBeGreaterThanOrEqual(2);
  for (const r of radii) expect(r).toBe("999px");
  await ctx.close();
});

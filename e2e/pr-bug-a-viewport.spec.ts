/**
 * BUG A (2026-05-16) — TradeForm v2 visual walkthrough.
 *
 * The home-page `TradeDrawer` was deleted; the right-side `TradeForm`
 * on the market detail page is now the single trade UI surface. This
 * spec drives the rebuilt panel through every visible state at the
 * five canonical viewports so the screenshots can be eyeballed
 * post-merge.
 *
 * Backend is mocked end-to-end (`/markets`, `/markets/{addr}`,
 * `/config`, `/dmm/status`, `/balance/{addr}`, `/markets/{addr}/prices`)
 * because dev's cycler is dormant and would otherwise produce 0
 * ACTIVE markets. Mock data covers the happy path: ACTIVE market,
 * orderbook with depth on both sides, $150 available balance.
 *
 * Checkpoints per viewport:
 *   1. Initial render — pp-trade-v2 header + tabs + prob bar + direction
 *      + amount + payoff primary
 *   2. Toggle order-type pill MARKET → LIMIT — limit-price input +
 *      Expires segment appear
 *   3. Toggle Down direction — flat fill flips, prob bar unaffected
 *   4. Expand Details accordion — 5-line breakdown visible
 *   5. Type stake that exceeds balance — inline red error replaces
 *      "To Win", CTA flips to "Deposit"
 */

import { test, expect } from "@playwright/test";
import path from "path";

const OUT = path.join(process.cwd(), "e2e", "screenshots", "pr-bug-a");

const VIEWPORTS = [
  { name: "375-iphone-se", width: 375, height: 1400 },
  { name: "390-iphone-14", width: 390, height: 1400 },
  { name: "768-ipad-portrait", width: 768, height: 1200 },
  { name: "1280-laptop", width: 1280, height: 1000 },
  { name: "1920-large", width: 1920, height: 1080 },
];

// Composite market key format expected by `parseCompositeMarketKey`:
// `0x{40-hex-settlement}-{marketId}`. Anything else short-circuits to the
// EmptyState "Invalid market link" panel and never renders TradeForm.
const MOCK_SETTLEMENT = "0x1111111111111111111111111111111111111111";
const MOCK_ADDR = `${MOCK_SETTLEMENT}-9001`;

function mockBackend(page: import("@playwright/test").Page) {
  const nowSec = Math.floor(Date.now() / 1000);
  const market = {
    address: MOCK_ADDR,
    marketId: "9001",
    settlementAddress: MOCK_SETTLEMENT,
    pairId: "BTC-USD",
    pairSymbol: "BTC-USD",
    chartSymbol: "BTC",
    pairIdHex: "0xabc",
    startTime: nowSec - 60,
    endTime: nowSec + 240,
    duration: 300,
    status: "ACTIVE",
    winner: null,
    upPrice: "6200",
    downPrice: "3800",
    strikePrice: "78000000000000",
    strikeDecimals: 18,
    settlementPrice: "0",
    volume: "421810", // atomic USDT (6dp) → $0.42 — keep as integer string,
                     // BigInt(volume) is called downstream
  };
  return Promise.all([
    // Single broad handler for every /markets* call. Differentiates by
    // URL suffix so list / detail / prices all flow through one funnel.
    page.route(/dev-api\.pulsepairs\.com\/markets/, (route) => {
      const u = route.request().url();
      if (u.includes("/prices")) {
        route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        return;
      }
      if (u.includes(`/markets/${MOCK_ADDR}`)) {
        const detail = {
          ...market,
          timeRemainingSeconds: 240,
          orderBook: {
            up: { bestBid: { price: 6100, depth: "1000000000" }, bestAsk: { price: 6300, depth: "1000000000" } },
            down: { bestBid: { price: 3700, depth: "1000000000" }, bestAsk: { price: 3900, depth: "1000000000" } },
          },
        };
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detail) });
        return;
      }
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([market]) });
    }),
    page.route(/\/config/, (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          platformFeeBps: 70,
          makerFeeBps: 80,
          peakFeeBps: 200,
          feeModel: "probability_weighted",
          dmmRebateBps: 0,
        }),
      });
    }),
    page.route(/\/dmm\/status/, (route) => {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ isDmm: false }) });
    }),
    page.route(/\/balance\//, (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ available: "150000000", cachedBalance: "150000000", inOrders: "0" }),
      });
    }),
    page.route(/\/orderbook/, (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          up: { asks: [], bids: [] },
          down: { asks: [], bids: [] },
        }),
      });
    }),
    page.addInitScript(() => {
      document.cookie = "pp.cookie.consent.v1=accepted; path=/; max-age=31536000";
      document.cookie = "pp-country=DE; path=/; max-age=31536000";
    }),
  ]);
}

for (const vp of VIEWPORTS) {
  test(`TradeForm v2 initial render (${vp.name})`, async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}\n${e.stack}`));
    page.on("console", (m) => { if (m.type() === "error") console.log(`[console.error] ${m.text()}`); });
    await mockBackend(page);
    await page.goto(`/market/${MOCK_ADDR}`);
    await page.waitForSelector(".pp-trade-v2", { timeout: 15_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${vp.width}__01-initial.png`), fullPage: true });
    await ctx.close();
  });
}

test("TradeForm v2 — LIMIT mode reveals limit price + Expires (1280)", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const page = await ctx.newPage();
  await mockBackend(page);
  await page.goto(`/market/${MOCK_ADDR}`);
  await page.waitForSelector(".pp-trade-v2", { timeout: 15_000 });
  // Toggle order-type pill — short click flips MARKET ↔ LIMIT.
  await page.locator(".pp-trade-v2__otype").click();
  await page.waitForTimeout(300);
  // Both the limit-price stepper row and the Expires segment must appear.
  await expect(page.locator(".pp-trade-v2__limit")).toBeVisible();
  await expect(page.locator(".pp-trade-v2__expires")).toBeVisible();
  await page.screenshot({ path: path.join(OUT, `1280__02-limit-mode.png`), fullPage: true });
  await ctx.close();
});

test("TradeForm v2 — Down direction flips flat fill (1280)", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const page = await ctx.newPage();
  await mockBackend(page);
  await page.goto(`/market/${MOCK_ADDR}`);
  await page.waitForSelector(".pp-trade-v2", { timeout: 15_000 });
  await page.locator(".pp-trade-v2__direction-btn--down").click();
  await page.waitForTimeout(300);
  await expect(page.locator(".pp-trade-v2__direction-btn--down.pp-trade-v2__direction-btn--on")).toBeVisible();
  await page.screenshot({ path: path.join(OUT, `1280__03-down-selected.png`), fullPage: true });
  await ctx.close();
});

test("TradeForm v2 — Details accordion expands (1280)", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const page = await ctx.newPage();
  await mockBackend(page);
  await page.goto(`/market/${MOCK_ADDR}`);
  await page.waitForSelector(".pp-trade-v2", { timeout: 15_000 });
  // Type a valid amount so the payoff numbers are non-zero.
  await page.locator(".pp-trade-v2__amount-input").fill("25");
  await page.locator(".pp-trade-v2__details-summary").click();
  await page.waitForTimeout(300);
  await expect(page.locator(".pp-trade-v2__details-row").first()).toBeVisible();
  await page.screenshot({ path: path.join(OUT, `1280__04-details-open.png`), fullPage: true });
  await ctx.close();
});

test("TradeForm v2 — disconnected wallet shows WalletConnectorList (1280)", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const page = await ctx.newPage();
  await mockBackend(page);
  await page.goto(`/market/${MOCK_ADDR}`);
  await page.waitForSelector(".pp-trade-v2", { timeout: 15_000 });
  // Without a wallet the CTA is suppressed and the connect block renders
  // instead. State-adaptive CTA labels for connected-wallet flows
  // (Deposit, Sign in, Buy More UP) are covered by the wallet-mocked
  // phase-4d ladder spec — wiring a mock wallet here would duplicate
  // that harness for no visual gain.
  await expect(page.locator(".pp-trade-v2__connect")).toBeVisible();
  await expect(page.locator(".pp-trade-v2__terms-link")).toHaveCount(0);
  await page.screenshot({ path: path.join(OUT, `1280__05-disconnected.png`), fullPage: true });
  await ctx.close();
});

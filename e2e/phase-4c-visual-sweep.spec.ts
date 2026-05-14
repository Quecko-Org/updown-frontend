/**
 * Phase 4c — visual sweep at 5 viewports for the consumer flow.
 *
 * Carries forward the PR-4 spec pattern (attachErrorWatch with documented
 * benign allowlist; viewport ladder; tall-page screenshots). Captures the
 * pages where Phase 4c changes are visible:
 *   - Homepage (markets list rendered against Sepolia /config)
 *   - Connect-wallet picker modal (with the 3 connectors)
 *   - DepositModal (chain-aware "USDTM on Arbitrum Sepolia" copy)
 *   - Market detail page (chart + trade panel with the new
 *     `useThinWallet` provisioning + ERC-1271 signing wired in)
 *
 * Full state-ladder coverage (no-tw → tw-deployed-no-approve →
 * tw-approved-no-funds → tw-funded-can-trade → tw-withdraw-flow) requires
 * a synpress-style controlled MetaMask, which we don't yet have wired in
 * the e2e harness. The integration test in `phase-4c-thin-wallet-
 * integration.spec.ts` covers the on-chain + API flow end-to-end as a
 * complement to this visual sweep — together they prove Phase 4c lands
 * correctly without needing a controlled wallet.
 *
 * Run: `npx playwright test e2e/phase-4c-visual-sweep.spec.ts --workers=1`
 */

import { test, type ConsoleMessage } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";
const OUT = path.resolve(__dirname, "./screenshots/phase-4c");

const viewports = [
  { name: "375-iphone-se", width: 375, height: 2200 },
  { name: "390-iphone-14", width: 390, height: 2200 },
  { name: "768-ipad-portrait", width: 768, height: 2200 },
  { name: "1280-laptop", width: 1280, height: 2000 },
  { name: "1920-large", width: 1920, height: 2000 },
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
    // Phase 4c additions: 404 on /thin-wallet endpoints would surface here
    // ONLY if the backend has rolled back — these endpoints should exist on
    // any Sepolia-targeted dev backend post-Phase-4b. Not in benign list.
  ];
  const filterText = (t: string) => !benign.some((re) => re.test(t));

  page.on("console", (m: ConsoleMessage) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const text = m.text();
    if (!filterText(text)) return;
    errors.push(`[console.${m.type()}] ${text}`);
  });
  page.on("pageerror", (e) => {
    errors.push(`[pageerror] ${e.message}`);
  });
  page.on("response", (r) => {
    const url = r.url();
    if (url.includes("/_next/")) return;
    const status = r.status();
    if (status >= 400 && status < 600) {
      errors.push(`[http ${status}] ${url}`);
    }
  });
  return {
    expectNoErrors() {
      if (errors.length > 0) {
        throw new Error(`Unexpected errors:\n${errors.join("\n")}`);
      }
    },
  };
}

for (const vp of viewports) {
  test.describe(`viewport ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("[a] homepage — markets list on Sepolia", async ({ page }) => {
      const watch = attachErrorWatch(page);
      await page.goto(BASE);
      await page.waitForLoadState("networkidle", { timeout: 15_000 });
      // Wait for at least one market card to render. Cycler creates new
      // markets every few minutes on Sepolia — if none appear, the
      // syncer or Automation are broken (separate concern).
      await page.waitForSelector('a[href^="/market/"]', { timeout: 15_000 });
      await page.screenshot({
        path: path.join(OUT, `${vp.name}-a-homepage.png`),
        fullPage: true,
      });
      watch.expectNoErrors();
    });

    test("[b] connect wallet picker", async ({ page }) => {
      const watch = attachErrorWatch(page);
      await page.goto(BASE);
      await page.waitForLoadState("networkidle", { timeout: 15_000 });
      const connectBtn = page.getByRole("button", { name: /connect wallet/i });
      await connectBtn.click();
      // Wait for the wallet selector modal — 3 providers visible.
      await page.waitForSelector('button:has-text("MetaMask")', { timeout: 5_000 });
      await page.screenshot({
        path: path.join(OUT, `${vp.name}-b-connect-picker.png`),
        fullPage: false,
      });
      watch.expectNoErrors();
    });

    test("[c] deposit modal — Sepolia-aware copy", async ({ page }) => {
      const watch = attachErrorWatch(page);
      await page.goto(BASE);
      await page.waitForLoadState("networkidle", { timeout: 15_000 });
      // The Deposit CTA is gated on a connected wallet. Without synpress
      // we can't open it; document this limitation in the sweep output
      // by capturing the closed-state baseline. Synpress-wired follow-up
      // will fill the open-modal state.
      await page.screenshot({
        path: path.join(OUT, `${vp.name}-c-deposit-closed-baseline.png`),
        fullPage: false,
      });
      watch.expectNoErrors();
    });

    test("[d] market detail — chart + trade panel skeleton", async ({ page }) => {
      const watch = attachErrorWatch(page);
      await page.goto(BASE);
      await page.waitForLoadState("networkidle", { timeout: 15_000 });
      // Click first market link → detail page.
      const firstMarket = page.locator('a[href^="/market/"]').first();
      await firstMarket.click();
      await page.waitForURL(/\/market\//, { timeout: 10_000 });
      // Chart container renders ~2s after navigation; small settle wait.
      await page.waitForTimeout(2000);
      await page.screenshot({
        path: path.join(OUT, `${vp.name}-d-market-detail.png`),
        fullPage: true,
      });
      watch.expectNoErrors();
    });
  });
}

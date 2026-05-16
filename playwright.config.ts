import { defineConfig, devices } from "@playwright/test";

/**
 * Multi-project Playwright config.
 *
 *   api-smoke      — pre-existing API health + Phase 4c integration specs.
 *                    No browser; runs against a backend URL.
 *
 *   visual-sweep   — pre-existing visual sweep specs at 5 viewports.
 *                    Headless chromium against deployed dev frontend.
 *
 *   phase-4d       — wallet-driven ladder (Phase 4d, 2026-05-16).
 *                    Headless chromium against `npm run dev` (or
 *                    PHASE4D_BASE override). Uses mock-injected
 *                    window.ethereum from e2e/_helpers/mockWallet.ts.
 *
 * Run a single project: `npx playwright test --project=phase-4d`
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // Sepolia state is shared — serial avoids races on shared markets
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Spin a local Next.js dev server only when the phase-4d project runs.
  // Other projects target deployed dev / backend URLs and don't need it.
  webServer: process.env.PHASE4D_NO_WEBSERVER
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
      },
  use: {
    baseURL: process.env.PLAYWRIGHT_API_BASE_URL ?? "https://dev-api.pulsepairs.com",
  },
  projects: [
    {
      name: "api-smoke",
      testMatch: ["api-health.spec.ts", "phase-4c-thin-wallet-integration.spec.ts"],
      use: {
        baseURL: process.env.PLAYWRIGHT_API_BASE_URL ?? "https://dev-api.pulsepairs.com",
      },
    },
    {
      name: "visual-sweep",
      testMatch: ["pr-*-viewport.spec.ts", "phase-4c-visual-sweep.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "https://dev.pulsepairs.com",
      },
    },
    {
      name: "phase-4d",
      testMatch: ["phase-4d-thinwallet-ladder.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.PHASE4D_BASE ?? "http://localhost:3000",
      },
    },
  ],
});

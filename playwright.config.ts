import { defineConfig } from "@playwright/test";

/**
 * API-only smoke tests. Set PLAYWRIGHT_API_BASE_URL if the backend is not on localhost:3001.
 * Requires a running backend (`cd backend && npm run dev`).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_API_BASE_URL ?? "https://dev-api.pulsepairs.com",
  },
});

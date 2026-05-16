import type { Page, ConsoleMessage } from "@playwright/test";

/**
 * Standard error-watch hook used across every Playwright spec.
 *
 * Captures:
 *   - console.error / console.warning (filtered through a benign allowlist)
 *   - pageerror (uncaught JS exceptions)
 *   - HTTP responses with status 4xx/5xx (excluding /_next/* asset chatter)
 *
 * The benign allowlist is intentionally explicit — every entry is a known
 * non-defect (3rd-party CDN flakes, dev-mode bundler chatter, intentional
 * 404s on optional endpoints). New entries require justification + a link
 * to where the noise is being generated.
 *
 * Call at the top of every test; assert in afterEach or at the end of
 * the test body via `watch.expectNoErrors()`.
 *
 * Single source of truth — DO NOT copy-paste this into individual specs.
 * Past lesson: copy-paste drift across pr-1..pr-4 specs let a real
 * console.error slip through one spec because its allowlist had a too-
 * permissive regex. One helper, one list, audited together.
 */
export function attachErrorWatch(page: Page) {
  const errors: string[] = [];
  const benign: RegExp[] = [
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
    // walletconnect's relay noise during clean-EOA scenarios
    /relay\.walletconnect\.(com|org)/i,
    // posthog blocked by adblocker in some CI envs
    /posthog\.com/i,
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
    errors,
    expectNoErrors() {
      if (errors.length > 0) {
        throw new Error(`Unexpected errors:\n${errors.join("\n")}`);
      }
    },
  };
}

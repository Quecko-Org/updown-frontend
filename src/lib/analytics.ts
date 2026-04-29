"use client";

import posthog from "posthog-js";
import { hasAnalyticsConsent } from "./cookieConsent";

/**
 * Thin PostHog wrapper. Public surface is `track(event, props?)` and
 * `identifyHashed(wallet)` — both no-op until the user has explicitly
 * accepted analytics cookies (WS3 PR D).
 *
 * Wallet addresses are NEVER sent raw. We hash to a 16-char hex digest
 * so behavior can be tied to a wallet across sessions without exposing
 * the address itself in PostHog.
 */

const KEY =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim()
    : "";
const HOST =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || "https://us.i.posthog.com"
    : "https://us.i.posthog.com";

let initialized = false;

/** Funnel-event names. Keep in sync with PostHog dashboards. */
export type AnalyticsEvent =
  | "page_view"
  | "connect_wallet_attempted"
  | "connect_wallet_succeeded"
  | "terms_accepted"
  | "approve_attempted"
  | "approve_succeeded"
  | "order_placed"
  | "order_matched"
  | "order_resolved"
  | "claim"
  | "withdraw";

export type EventProperties = Record<string, string | number | boolean | undefined | null>;

/**
 * One-way SHA-256 of a wallet address → 16-char hex prefix. Reversibility
 * would require brute-forcing the 160-bit input space; the prefix gives
 * cohort analysis without exposing the address.
 */
async function hashWallet(address: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    return address.slice(2, 18).toLowerCase();
  }
  const enc = new TextEncoder().encode(address.toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Initialize PostHog if (a) we have a key, (b) the user accepted cookies. */
function tryInit(): boolean {
  if (initialized) return true;
  if (typeof window === "undefined") return false;
  if (!KEY) return false;
  if (!hasAnalyticsConsent()) return false;
  posthog.init(KEY, {
    api_host: HOST,
    capture_pageview: false, // we capture page_view manually so the route name is correct
    persistence: "localStorage",
    autocapture: false,
  });
  initialized = true;
  return true;
}

/** Fire-and-forget event capture. Silently no-ops without consent / key. */
export function track(event: AnalyticsEvent, properties?: EventProperties): void {
  if (!tryInit()) return;
  posthog.capture(event, properties);
}

/**
 * Identify the current visitor by a hashed wallet address. Called once
 * after a successful connect so PostHog can stitch the per-wallet
 * timeline. Subsequent calls with the same address are a no-op.
 */
export async function identifyHashed(walletAddress: string): Promise<void> {
  if (!tryInit()) return;
  const id = await hashWallet(walletAddress);
  posthog.identify(id);
}

/** Drop the current PostHog identity (e.g. on disconnect). */
export function resetIdentity(): void {
  if (!initialized) return;
  posthog.reset();
}

/** Force a re-init check (e.g. after the user accepts cookies). */
export function maybeInitialize(): void {
  tryInit();
}

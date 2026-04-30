"use client";

/**
 * WebSocket auth (PR-19, P0-18).
 *
 * Closes the WS info-disclosure: the server now requires every
 * `orders:<wallet>` / `balance:<wallet>` subscription to authenticate
 * via an EIP-712 signed handshake first. This module owns:
 *
 *   - The typed-data builder for the WsAuth EIP-712 message.
 *   - An in-memory session-token cache keyed by wallet address. Tokens
 *     are NOT persisted to localStorage on purpose — closing the tab
 *     forces a re-sign, which is the security property we want. On
 *     transient WS reconnects within the 24h TTL, the cached token is
 *     replayed so the user isn't re-prompted to sign on every blip.
 *
 * Domain is intentionally distinct from the order-signing domain so a
 * captured order signature can never be replayed as a WS auth (and vice
 * versa). Keep `domain.name` in sync with backend `wsAuth.ts`.
 */

import { CHAIN_ID } from "./env";

export const WS_AUTH_DOMAIN = {
  name: "PulsePairs WebSocket Auth",
  version: "1",
  chainId: CHAIN_ID,
  verifyingContract: "0x0000000000000000000000000000000000000000",
} as const;

export const WS_AUTH_TYPES = {
  WsAuth: [
    { name: "wallet", type: "address" },
    { name: "timestamp", type: "uint256" },
    { name: "sessionId", type: "bytes32" },
  ],
} as const;

export type WsAuthMessage = {
  wallet: `0x${string}`;
  timestamp: bigint;
  sessionId: `0x${string}`;
};

export function buildWsAuthTypedData(msg: WsAuthMessage) {
  return {
    domain: WS_AUTH_DOMAIN,
    types: WS_AUTH_TYPES,
    primaryType: "WsAuth" as const,
    message: msg,
  };
}

/** Generate a fresh 32-byte session id (hex string). */
export function newSessionId(): `0x${string}` {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `0x${hex}`;
  }
  // Last-resort fallback (Node < 19 in tests). Math.random is NOT
  // crypto-grade but the sessionId only needs to be unique within the
  // 60s replay window per (wallet, sessionId) pair.
  const hex = Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
  return `0x${hex}`;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** In-memory token cache. Module-level Map; lost on page reload. */
const tokenCache = new Map<string, CachedToken>();

/** Returns a cached, non-expired token for the wallet, or null. */
export function getCachedToken(wallet: string): string | null {
  const entry = tokenCache.get(wallet.toLowerCase());
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    tokenCache.delete(wallet.toLowerCase());
    return null;
  }
  return entry.token;
}

export function setCachedToken(
  wallet: string,
  token: string,
  expiresAt: number,
): void {
  tokenCache.set(wallet.toLowerCase(), { token, expiresAt });
}

export function clearCachedToken(wallet: string): void {
  tokenCache.delete(wallet.toLowerCase());
}

/** Drop ALL cached tokens (e.g. when the user disconnects their wallet). */
export function clearAllCachedTokens(): void {
  tokenCache.clear();
}

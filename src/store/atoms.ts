import { atom } from "jotai";
import type { PublicClient } from "viem";
import type { ApiConfig } from "@/lib/api";
import type { BalanceResponse } from "@/lib/api";

/** Speed-market–style smart account state (WalletContext). */
export const userSmartAccount = atom<string>("");
export const userSmartAccountClient = atom<unknown>(null);
export const userPublicClient = atom<PublicClient | null>(null);

export const apiConfigAtom = atom<ApiConfig | null>(null);

/** True after scoped session grant + backend register succeeded (or restored via register). */
export const sessionReadyAtom = atom<boolean>(false);

/**
 * True when a silent session restore attempt failed after retry. Drives the visible
 * "Re-authorize" CTA so the user knows why trading is blocked instead of staring at a
 * frozen spinner (prior behavior: only a console.error).
 */
export const sessionRestoreFailedAtom = atom<boolean>(false);

export const wsConnectedAtom = atom(false);

/** Last time a WebSocket message was handled (ms since epoch); for stale UI hints. */
export const wsLastEventAtAtom = atom<number | null>(null);

export const balanceSnapshotAtom = atom<BalanceResponse | null>(null);

/**
 * Option C — outstanding sign requests this session, indexed by requestId.
 * Populated when a `session_sign_request` arrives on WS; the entry is removed
 * when the client has replied AND received the `sign_response_ack`, OR when
 * the backend-side expiresAt passes.
 *
 * Consumers:
 *   - MyOrdersOnMarket reads the Map to show a "PENDING" chip on fresh
 *     fills for any market with an in-flight sign request.
 *   - TradeForm reads `sessionAmountUsedAtom` (below) for the "remaining
 *     allowance" preview.
 */
export type PendingSignRequest = {
  requestId: string;
  market: string;
  option: number;
  amount: string; // USDT base units as string — preserves bigint precision across atom
  expiresAt: number;
};
export const pendingSignRequestsAtom = atom<Map<string, PendingSignRequest>>(
  new Map()
);

/**
 * Option C — cumulative sum of `amount` for every sign request this client
 * has accepted (routed + acked) since the current session grant. The
 * remaining-allowance preview in TradeForm derives from
 * `sessionScope.usdtAllowance - sessionAmountUsed`.
 *
 * Stored as string (base units) for bigint precision; readers parse with BigInt().
 * Reset to "0" on every fresh session grant.
 */
export const sessionAmountUsedAtom = atom<string>("0");

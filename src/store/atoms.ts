import { atom } from "jotai";
import type { PublicClient } from "viem";
import type { ApiConfig, BalanceResponse } from "@/lib/api";

/**
 * Smart-account address derived from the connected EOA via Alchemy. Kept
 * for back-compat with read paths that still reference it as a stable
 * cache key, but is no longer the trading custodian — under Path 1 the
 * EOA holds USDT and signs orders directly. The atom is set during
 * connect; consumers should generally prefer `walletAddress` (EOA).
 */
export const userSmartAccount = atom<string>("");
export const userSmartAccountClient = atom<unknown>(null);
export const userPublicClient = atom<PublicClient | null>(null);

export const apiConfigAtom = atom<ApiConfig | null>(null);

export const wsConnectedAtom = atom(false);

/** Last time a WebSocket message was handled (ms since epoch); for stale UI hints. */
export const wsLastEventAtAtom = atom<number | null>(null);

export const balanceSnapshotAtom = atom<BalanceResponse | null>(null);

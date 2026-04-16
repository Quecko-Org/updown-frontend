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

export const wsConnectedAtom = atom(false);

/** Last time a WebSocket message was handled (ms since epoch); for stale UI hints. */
export const wsLastEventAtAtom = atom<number | null>(null);

export const balanceSnapshotAtom = atom<BalanceResponse | null>(null);

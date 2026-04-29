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

/**
 * Geo-block status. `loading` while the lookup is in flight, `restricted`
 * if the resolved country is on the block list, `allowed` otherwise.
 * `unknown` means the lookup failed — UI treats it as ALLOWED (fail-open
 * is the right call for usability; production lockdown lives at the edge
 * via the CloudFront-Viewer-Country header, see lib/geo.ts).
 */
export type GeoStatus = "loading" | "allowed" | "restricted" | "unknown";

export type GeoState = {
  status: GeoStatus;
  country: string | null;
};

export const geoStateAtom = atom<GeoState>({ status: "loading", country: null });

/**
 * Cookie / analytics consent (EU GDPR-grade). `unset` triggers the consent
 * banner. `accepted` is the only state that lets analytics SDKs (PR E)
 * initialize. Persisted via lib/cookieConsent.
 */
export type CookieConsentStatus = "unset" | "accepted" | "rejected";
export const cookieConsentAtom = atom<CookieConsentStatus>("unset");

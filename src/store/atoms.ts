import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { PublicClient } from "viem";
import type { ApiConfig, BalanceResponse } from "@/lib/api";
import {
  MAX_NOTIFICATIONS_PER_WALLET,
  NOTIFICATIONS_STORAGE_KEY,
  firePushNotification,
  type Notification,
  type PushPermission,
} from "@/lib/notifications";

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

/**
 * Per-wallet notification history. Keyed by EOA (lowercased). Persisted via
 * `atomWithStorage` so the bell remembers entries across reloads.
 *
 * Read with `useAtomValue(notificationsByWalletAtom)`; mutate ONLY through
 * the dedicated write atoms below so the dedupe + trim invariants hold.
 */
export const notificationsByWalletAtom = atomWithStorage<Record<string, Notification[]>>(
  NOTIFICATIONS_STORAGE_KEY,
  {},
);

/**
 * Append a notification for a specific wallet. Dedupes by `id` (terminal WS
 * frames can be re-emitted on reconnect; we don't want the bell to spam).
 * Also fires the OS-level push notification when permission is granted.
 *
 * Write-only — components / hooks call:
 *   const add = useSetAtom(addNotificationAtom);
 *   add({ wallet, notification });
 */
export const addNotificationAtom = atom(
  null,
  (
    get,
    set,
    payload: { wallet: string; notification: Notification },
  ) => {
    const key = payload.wallet.toLowerCase();
    const map = get(notificationsByWalletAtom);
    const existing = map[key] ?? [];
    if (existing.some((n) => n.id === payload.notification.id)) return;
    const next = [payload.notification, ...existing].slice(0, MAX_NOTIFICATIONS_PER_WALLET);
    set(notificationsByWalletAtom, { ...map, [key]: next });
    // Fire OS push best-effort. firePushNotification no-ops when permission
    // is anything other than "granted", so we don't need to gate here.
    firePushNotification(payload.notification);
  },
);

/** Mark every notification for a wallet as read. */
export const markAllNotificationsReadAtom = atom(
  null,
  (get, set, wallet: string) => {
    const key = wallet.toLowerCase();
    const map = get(notificationsByWalletAtom);
    const list = map[key];
    if (!list || list.length === 0) return;
    set(notificationsByWalletAtom, {
      ...map,
      [key]: list.map((n) => (n.read ? n : { ...n, read: true })),
    });
  },
);

/** Clear the entire history for a wallet. */
export const clearNotificationsAtom = atom(
  null,
  (get, set, wallet: string) => {
    const key = wallet.toLowerCase();
    const map = get(notificationsByWalletAtom);
    if (!map[key] || map[key].length === 0) return;
    const { [key]: _drop, ...rest } = map;
    void _drop;
    set(notificationsByWalletAtom, rest);
  },
);

/**
 * OS-level push permission state. UI should hydrate this from
 * `getPushPermission()` on mount and keep it in sync after a request prompt.
 */
export const pushPermissionAtom = atom<PushPermission>("default");

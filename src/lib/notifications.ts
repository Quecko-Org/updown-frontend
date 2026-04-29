"use client";

/**
 * Notification model + browser-push helpers (WS3 PR G).
 *
 * Two surfaces:
 *
 *   1. In-app: NotificationBell renders a list from `notificationsByWallet
 *      Atom`. Pushed to via `addNotificationAtom` from the WebSocket layer
 *      whenever a terminal order_update or relevant market_resolved arrives.
 *      Per-wallet history persists via `atomWithStorage` so the dropdown
 *      survives reload + wallet-switch round-trips.
 *
 *   2. Browser push (Notification API) — strictly opt-in. Never requested
 *      automatically. The bell exposes a "Enable browser notifications"
 *      action; once granted we mirror in-app entries to OS-level
 *      notifications.
 */

import type { CancelReason } from "./derivations";

export type NotificationKind =
  | "order_filled"
  | "order_cancelled"
  | "market_resolved";

export type Notification = {
  /** Stable id used for de-duplication (re-emitted WS frames must not double-write). */
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Deep link the dropdown row navigates to on click. */
  href?: string;
  /** ms since epoch; bell sorts newest-first. */
  ts: number;
  read: boolean;
};

/** Hard cap on per-wallet retained history. Older entries fall off the tail. */
export const MAX_NOTIFICATIONS_PER_WALLET = 50;

/** Storage key for the wallet→notifications map. v1 is the first shipped schema. */
export const NOTIFICATIONS_STORAGE_KEY = "pp.notifications.v1";

export type PushPermission = NotificationPermission | "unsupported";

/** True when the runtime exposes the W3C Notification API (some embedded browsers don't). */
export function pushIsSupported(): boolean {
  if (typeof window === "undefined") return false;
  return typeof window.Notification !== "undefined";
}

/** Read the current OS-level permission state. Returns "unsupported" off-platform. */
export function getPushPermission(): PushPermission {
  if (!pushIsSupported()) return "unsupported";
  return window.Notification.permission;
}

/**
 * Prompt the user for OS-level notification permission. Resolves to the
 * resulting permission state. Caller is expected to gate on a button click —
 * Chrome/Safari ignore programmatic requests outside a user gesture.
 */
export async function requestPushPermission(): Promise<PushPermission> {
  if (!pushIsSupported()) return "unsupported";
  try {
    const result = await window.Notification.requestPermission();
    return result;
  } catch {
    return window.Notification.permission;
  }
}

/** Fire a native browser notification. No-op when permission != granted. */
export function firePushNotification(n: Notification): void {
  if (!pushIsSupported()) return;
  if (window.Notification.permission !== "granted") return;
  try {
    const native = new window.Notification(n.title, {
      body: n.body,
      tag: n.id,
      icon: "/icon.png",
    });
    if (n.href) {
      native.onclick = () => {
        window.focus();
        window.location.href = n.href!;
      };
    }
  } catch {
    /* swallow — push is best-effort. */
  }
}

/** Format an order amount (atomic USDT) as $X. Mirrors lib/derivations style. */
function fmtUsdAtomic(atomic: string | number | undefined): string {
  if (atomic == null) return "$0";
  const n = typeof atomic === "string" ? Number(atomic) : atomic;
  if (!Number.isFinite(n)) return "$0";
  return `$${(n / 1_000_000).toFixed(2)}`;
}

/**
 * Translate a terminal order_update into a Notification. Returns null for
 * non-terminal frames (the bell only retains user-actionable events).
 */
export function notificationFromTerminalOrder(args: {
  orderId: string;
  marketAddress: string;
  status: string;
  amount?: string;
  filledAmount?: string;
  reason?: CancelReason | string;
}): Notification | null {
  const { orderId, marketAddress, status, amount, filledAmount, reason } = args;
  const ts = Date.now();
  const id = `${orderId}-${status}`;
  const href = `/portfolio`;

  if (status === "FILLED") {
    return {
      id,
      kind: "order_filled",
      title: "Order filled",
      body: `${fmtUsdAtomic(amount)} filled.`,
      href,
      ts,
      read: false,
    };
  }
  if (status === "CANCELLED") {
    const r = String(reason ?? "");
    if (r === "MARKET_ENDED") {
      return {
        id,
        kind: "market_resolved",
        title: "Market resolved",
        body: "Open order returned — market ended before fill.",
        href,
        ts,
        read: false,
      };
    }
    return {
      id,
      kind: "order_cancelled",
      title: "Order cancelled",
      body:
        Number(filledAmount ?? "0") > 0
          ? `Partially filled — remainder cancelled.`
          : "No matching liquidity — order cancelled.",
      href,
      ts,
      read: false,
    };
  }
  if (status === "RESOLVED") {
    return {
      id,
      kind: "market_resolved",
      title: "Position resolved",
      body: "Market settled. Open the portfolio to claim.",
      href: `/market/${marketAddress.toLowerCase()}`,
      ts,
      read: false,
    };
  }
  return null;
}

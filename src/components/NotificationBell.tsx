"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearNotificationsAtom,
  markAllNotificationsReadAtom,
  notificationsByWalletAtom,
  pushPermissionAtom,
} from "@/store/atoms";
import { useWalletContext } from "@/context/WalletContext";
import {
  getPushPermission,
  pushIsSupported,
  requestPushPermission,
} from "@/lib/notifications";

/**
 * Header bell. Three things:
 *
 *  - Renders the unread-count badge sourced from `notificationsByWalletAtom`
 *    keyed on the connected EOA. Hidden entirely when no wallet is connected
 *    (notifications without an account-scope are noise).
 *  - Opens an absolute-positioned dropdown listing the most recent
 *    notifications, mark-all-read + clear actions, and (when permission is
 *    `default`) an "Enable browser notifications" CTA.
 *  - Hydrates `pushPermissionAtom` on mount so other surfaces (e.g.
 *    /settings, WS3 PR H) can read the live state.
 */
export function NotificationBell() {
  const { walletAddress, isWalletConnected } = useWalletContext();
  const all = useAtomValue(notificationsByWalletAtom);
  const markAllRead = useSetAtom(markAllNotificationsReadAtom);
  const clearAll = useSetAtom(clearNotificationsAtom);
  const [pushPerm, setPushPerm] = useAtom(pushPermissionAtom);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPushPerm(getPushPermission());
  }, [setPushPerm]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const list = useMemo(() => {
    if (!walletAddress) return [];
    return all[walletAddress.toLowerCase()] ?? [];
  }, [all, walletAddress]);

  const unread = useMemo(() => list.filter((n) => !n.read).length, [list]);

  // Mark-all-read fires on open (Slack-style): opening the panel
  // counts as "I saw them". Clearing is an explicit action.
  function handleOpen() {
    setOpen((o) => {
      const next = !o;
      if (next && walletAddress && unread > 0) {
        markAllRead(walletAddress);
      }
      return next;
    });
  }

  async function handleEnablePush() {
    const result = await requestPushPermission();
    setPushPerm(result);
  }

  if (!isWalletConnected || !walletAddress) return null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        className="pp-btn pp-btn--ghost pp-btn--sm"
        onClick={handleOpen}
        aria-label={
          unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
        }
        aria-expanded={open}
      >
        <span className="relative inline-flex">
          <Bell size={18} strokeWidth={1.5} />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute -right-1 -top-1 inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-[3px] text-[10px] font-semibold leading-none"
              style={{
                background: "var(--accent)",
                color: "var(--bg-0)",
              }}
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-[320px] rounded-[var(--r-lg)] border"
          style={{
            background: "var(--bg-1)",
            borderColor: "var(--border-0)",
            boxShadow: "var(--shadow-overlay)",
          }}
        >
          <div
            className="flex items-center justify-between px-3 py-2"
            style={{ borderBottom: "1px solid var(--border-0)" }}
          >
            <span
              className="pp-caption"
              style={{ color: "var(--fg-0)", fontWeight: 600 }}
            >
              Notifications
            </span>
            {list.length > 0 && (
              <button
                type="button"
                className="pp-caption pp-link"
                onClick={() => {
                  clearAll(walletAddress);
                }}
              >
                Clear all
              </button>
            )}
          </div>

          {pushIsSupported() && pushPerm === "default" && (
            <div
              className="flex items-center justify-between gap-3 px-3 py-2"
              style={{
                background: "var(--bg-0)",
                borderBottom: "1px solid var(--border-0)",
              }}
            >
              <span
                className="pp-caption"
                style={{ color: "var(--fg-1)" }}
              >
                Get pinged when an order fills.
              </span>
              <button
                type="button"
                className="pp-btn pp-btn--secondary pp-btn--sm"
                onClick={() => void handleEnablePush()}
              >
                Enable
              </button>
            </div>
          )}

          {list.length === 0 ? (
            <div
              className="px-3 py-6 text-center pp-caption"
              style={{ color: "var(--fg-2)" }}
            >
              No notifications yet.
            </div>
          ) : (
            <ul
              className="max-h-[360px] overflow-y-auto"
              style={{ scrollbarGutter: "stable" }}
            >
              {list.map((n) => {
                const Body = (
                  <div className="flex flex-col gap-0.5 px-3 py-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span
                        className="pp-body"
                        style={{
                          color: "var(--fg-0)",
                          fontWeight: n.read ? 400 : 600,
                        }}
                      >
                        {n.title}
                      </span>
                      <time
                        className="pp-caption pp-tabular"
                        style={{ color: "var(--fg-2)", whiteSpace: "nowrap" }}
                        dateTime={new Date(n.ts).toISOString()}
                      >
                        {formatRelative(n.ts)}
                      </time>
                    </div>
                    <span
                      className="pp-caption"
                      style={{ color: "var(--fg-1)" }}
                    >
                      {n.body}
                    </span>
                  </div>
                );
                return (
                  <li
                    key={n.id}
                    style={{ borderBottom: "1px solid var(--border-0)" }}
                  >
                    {n.href ? (
                      <Link
                        href={n.href}
                        onClick={() => setOpen(false)}
                        className="block hover:opacity-90"
                      >
                        {Body}
                      </Link>
                    ) : (
                      Body
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Compact relative-time formatter — the bell is a glance surface. */
function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`;
  return `${Math.round(diff / 86_400_000)}d`;
}


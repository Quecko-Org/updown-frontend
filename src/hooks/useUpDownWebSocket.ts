"use client";

import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { useSignTypedData } from "wagmi";
import { toast } from "sonner";
import {
  addNotificationAtom,
  wsConnectedAtom,
  wsLastEventAtAtom,
} from "@/store/atoms";
import { notificationFromTerminalOrder } from "@/lib/notifications";
import { wsStreamUrl } from "@/lib/env";
import {
  buildWsAuthTypedData,
  getCachedToken,
  newSessionId,
  setCachedToken,
} from "@/lib/wsAuth";
import type { BalanceResponse, MarketListItem, OrderBookResponse } from "@/lib/api";
import { applyOrderUpdateToList, buildTerminalOrderToast, type OrderUpdateLike } from "@/lib/derivations";

type WsPayload = {
  type: string;
  channel?: string;
  data?: unknown;
};

/** Keys we accept as a market identifier in the market cache (list uses `address`). */
function matchesMarketKey(m: Partial<MarketListItem> & { marketId?: string }, needle: Partial<MarketListItem> & { marketId?: string }) {
  if (needle.address && m.address) return m.address.toLowerCase() === needle.address.toLowerCase();
  if (needle.marketId && m.marketId) return m.marketId === needle.marketId;
  return false;
}

function walletChannels(walletLower: string) {
  return [
    `orders:${walletLower}`,
    `balance:${walletLower}`,
  ] as const;
}

function marketChannels(marketLower: string) {
  return [`orderbook:${marketLower}`, `trades:${marketLower}`] as const;
}

/**
 * Subscribes to `/stream`. Merges balance + order book updates into React Query.
 * Market list updates come from debounced invalidation on WS events plus focus refetch.
 *
 * TODO (test-debt, post-PR-19, P0-18 follow-up): this hook has zero unit-test
 * coverage — including the new EIP-712 auth handshake added in PR-19. The
 * file pre-dates a test infrastructure for hook+WebSocket interactions; any
 * future change here is on the hook author's eyeball + manual verification
 * via the dev wscat runbook. Eventual fix: add a tests/__mocks__/ws.ts
 * mock server harness and cover the auth state-machine transitions
 * (cached-token replay, sign-prompt, auth_ok deferred subscribe, wallet-
 * change re-auth, auth_error degradation to public-channels-only).
 * Tracked in TRACKING.md → Known test gaps.
 */
export function useUpDownWebSocket(opts: {
  wallet: string | null | undefined;
  marketAddress: string | null | undefined;
  enabled?: boolean;
}) {
  const { wallet, marketAddress, enabled = true } = opts;
  const queryClient = useQueryClient();
  const setWsConnected = useSetAtom(wsConnectedAtom);
  const setWsLastEventAt = useSetAtom(wsLastEventAtAtom);
  const addNotification = useSetAtom(addNotificationAtom);
  const { signTypedDataAsync } = useSignTypedData();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const marketInvalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const marketAddressRef = useRef(marketAddress);
  marketAddressRef.current = marketAddress;

  /** Last wallet string we applied to the socket (raw from props); null if none. */
  const subscribedWalletRef = useRef<string | null>(null);
  /** Last market address we applied (raw); null if none. */
  const subscribedMarketRef = useRef<string | null>(null);
  /** Wallet the current connection has successfully auth'd as. Cleared on
   *  every ws close so reconnect re-auths (or replays the cached token). */
  const authedWalletRef = useRef<string | null>(null);
  /** Set during an in-flight auth handshake to prevent double-prompts on
   *  rapid effect reruns or message-driven retries. */
  const authInFlightRef = useRef(false);

  const handleMessageRef = useRef<(ev: MessageEvent) => void>(() => {});

  handleMessageRef.current = (ev: MessageEvent) => {
    try {
      const msg = JSON.parse(String(ev.data)) as WsPayload & {
        wallet?: string;
        token?: string;
        expiresAt?: number;
      };
      const w = walletRef.current;
      // Auth handshake replies — set authedWalletRef so private subscribes
      // can fire, cache the token for transient reconnects.
      if (msg.type === "auth_ok" && typeof msg.wallet === "string") {
        authedWalletRef.current = msg.wallet.toLowerCase();
        if (typeof msg.token === "string" && typeof msg.expiresAt === "number") {
          setCachedToken(msg.wallet, msg.token, msg.expiresAt);
        }
        // Now safe to subscribe to private channels.
        const ws = wsRef.current;
        if (ws) syncWalletMarketSubscriptionsRef.current(ws);
        authInFlightRef.current = false;
        return;
      }
      if (msg.type === "auth_error") {
        authInFlightRef.current = false;
        // Don't loop-prompt the user — leave authedWallet null. Public
        // channels stay live; private channel subscribes will be silently
        // dropped by the server until the next connect cycle (or until
        // wallet changes and a fresh auth fires).
        console.warn("[ws] auth rejected; private channels disabled this session");
        return;
      }
      if (msg.type === "balance_update" && w) {
        const data = msg.data as BalanceResponse;
        queryClient.setQueryData(["balance", w.toLowerCase()], data);
      }
      const m = marketAddressRef.current;
      if (msg.type === "orderbook_update" && m && msg.data && typeof msg.data === "object") {
        const d = msg.data as { option?: number; snapshot?: OrderBookResponse["up"] };
        if ((d.option === 1 || d.option === 2) && d.snapshot) {
          queryClient.setQueryData<OrderBookResponse>(["orderbook", m.toLowerCase()], (prev) => {
            // Cold-cache seeding: prior version bailed on `!prev`, which dropped
            // every update arriving before the initial GET /orderbook hydrated.
            // With Fix 1b + hotfix #18 the book now changes fast, so that drop
            // window swallowed real orders on fresh market-detail loads. Seed
            // the counterpart side as empty; initial fetch reconciles shortly.
            const emptySnapshot: OrderBookResponse["up"] = { bids: [], asks: [] };
            const base: OrderBookResponse = prev ?? { up: emptySnapshot, down: emptySnapshot };
            const key = d.option === 1 ? "up" : "down";
            return { ...base, [key]: d.snapshot ?? base[key] };
          });
        }
      }
      if (msg.type === "market_created" && msg.data && typeof msg.data === "object") {
        // Optimistically prepend the new market to any cached markets list so the
        // card appears in ~1ms instead of ~1s. Authoritative refetch still lands below.
        const incoming = msg.data as Partial<MarketListItem> & { marketId?: string };
        if (incoming.address || incoming.marketId) {
          queryClient.setQueriesData<MarketListItem[] | undefined>({ queryKey: ["markets"] }, (old) => {
            if (!Array.isArray(old)) return old;
            if (old.some((m) => matchesMarketKey(m, incoming))) return old;
            return [incoming as MarketListItem, ...old];
          });
        }
      }
      if (msg.type === "market_resolved" && msg.data && typeof msg.data === "object") {
        // Flip the in-cache market to RESOLVED (or TRADING_ENDED if winner not yet set)
        // so MarketCard stops showing UP/DOWN buttons immediately on resolve.
        const incoming = msg.data as Partial<MarketListItem> & { marketId?: string };
        if (incoming.address || incoming.marketId) {
          queryClient.setQueriesData<MarketListItem[] | undefined>({ queryKey: ["markets"] }, (old) => {
            if (!Array.isArray(old)) return old;
            return old.map((m) =>
              matchesMarketKey(m, incoming)
                ? {
                    ...m,
                    status: incoming.status ?? "RESOLVED",
                    settlementPrice: incoming.settlementPrice ?? m.settlementPrice,
                    winner: incoming.winner ?? m.winner,
                  }
                : m
            );
          });
        }
      }
      // Real-time price updates → append to cached price history for live chart
      if (msg.type === "price_update" && msg.data && typeof msg.data === "object") {
        const d = msg.data as { symbol?: string; price?: string | number; time?: number };
        if (d.symbol && d.price) {
          const p = typeof d.price === "string" ? Number(d.price) : d.price;
          const t = d.time ?? Date.now();
          if (Number.isFinite(p) && p > 0) {
            queryClient.setQueryData<unknown>(["priceHistory", d.symbol], (prev: unknown) => {
              if (!Array.isArray(prev)) return prev;
              return [...prev, [t, String(p)]];
            });
          }
        }
      }
      // PR-20 Phase 2: per-market Chainlink snapshot pushed by the
      // backend snapshotter. Append to the corresponding ["marketPrices",
      // address] cache so MarketPriceChart redraws without re-fetching.
      // Namespaced distinctly from `price_update` (Binance-sourced spot
      // feed in useLivePriceFeed) so the two streams don't collide.
      //
      // Backend emits Chainlink's raw 8-decimals integer (`9000000000000`
      // for BTC at $90k). `getMarketPrices` descales the REST payload to
      // dollars; do the same here so cache entries are uniform regardless
      // of source.
      if (
        msg.type === "price_snapshot" &&
        msg.data &&
        typeof msg.data === "object"
      ) {
        const d = msg.data as {
          address?: string;
          timestampMs?: number;
          price?: string | number;
        };
        if (d.address && d.timestampMs && d.price) {
          const addr = String(d.address).toLowerCase();
          const t = Number(d.timestampMs);
          const rawN = typeof d.price === "string" ? Number(d.price) : d.price;
          if (Number.isFinite(t) && Number.isFinite(rawN) && rawN > 0) {
            const priceStr = (rawN / 1e8).toString();
            queryClient.setQueryData<unknown>(
              ["marketPrices", addr],
              (prev: unknown) => {
                if (!Array.isArray(prev)) return [[t, priceStr]];
                // Drop any existing entry at the same timestamp so a
                // chainlink-wins overwrite from the backend doesn't
                // produce a duplicate frame on the chart.
                const filtered = (prev as [number, string][]).filter(
                  (row) => row?.[0] !== t,
                );
                return [...filtered, [t, priceStr]];
              },
            );
          }
        }
      }
      if (msg.type === "market_created" || msg.type === "market_resolved") {
        if (marketInvalidateTimerRef.current) clearTimeout(marketInvalidateTimerRef.current);
        marketInvalidateTimerRef.current = setTimeout(() => {
          marketInvalidateTimerRef.current = null;
          queryClient.invalidateQueries({ queryKey: ["markets"] });
          const ma = marketAddressRef.current;
          if (ma) {
            queryClient.invalidateQueries({ queryKey: ["market", ma.toLowerCase()] });
          }
        }, 1000);
      }
      if (msg.type === "order_update" && msg.data && typeof msg.data === "object") {
        const update = msg.data as OrderUpdateLike;
        // Fix 1b: merge the update into every ["orders", wallet, ...] cache so
        // history / MyOrdersOnMarket reflect fills instantly instead of waiting
        // for the 20s refetch. `setQueriesData` matches by prefix, so this
        // covers both the unfiltered history list and any status-filtered list.
        if (w) {
          queryClient.setQueriesData({ queryKey: ["orders", w.toLowerCase()] }, (old) =>
            applyOrderUpdateToList(old as Parameters<typeof applyOrderUpdateToList>[0], update),
          );
        }
        const t = buildTerminalOrderToast(update, w);
        if (t) {
          if (t.kind === "info") toast.info(t.message, { id: t.id });
          else toast.success(t.message, { id: t.id });
        }
        // Persisted bell notification — survives reload, optionally
        // mirrored as an OS push (see addNotificationAtom). Same wallet-
        // match guard `buildTerminalOrderToast` runs internally.
        if (
          w &&
          update.id &&
          update.market &&
          update.status &&
          (!update.maker || update.maker.toLowerCase() === w.toLowerCase())
        ) {
          const n = notificationFromTerminalOrder({
            orderId: String(update.id),
            marketAddress: update.market,
            status: String(update.status),
            amount: update.amount,
            filledAmount: update.filledAmount,
            reason: update.reason,
          });
          if (n) addNotification({ wallet: w, notification: n });
        }
      }
      setWsLastEventAt(Date.now());
    } catch {
      /* ignore */
    }
  };

  const syncWalletMarketSubscriptionsRef = useRef<(ws: WebSocket) => void>(() => {});

  syncWalletMarketSubscriptionsRef.current = (ws: WebSocket) => {
    if (ws.readyState !== WebSocket.OPEN) return;

    const oldW = subscribedWalletRef.current;
    const oldM = subscribedMarketRef.current;
    const newW = walletRef.current?.trim() ? String(walletRef.current) : null;
    const newM = marketAddressRef.current?.trim() ? String(marketAddressRef.current) : null;

    const oldWKey = oldW?.toLowerCase() ?? null;
    const newWKey = newW?.toLowerCase() ?? null;
    const oldMKey = oldM?.toLowerCase() ?? null;
    const newMKey = newM?.toLowerCase() ?? null;

    // Wallet-private subscriptions (orders:, balance:) require the WS to
    // have completed the auth handshake for that exact wallet — see
    // PR-19. If we haven't auth'd (or auth is still in flight, or auth
    // failed) we skip the private subscribe; it'll fire after auth_ok.
    const authReady = newWKey != null && authedWalletRef.current === newWKey;

    if (oldWKey !== newWKey) {
      if (oldWKey && oldW) {
        const ch = [...walletChannels(oldWKey)];
        ws.send(JSON.stringify({ type: "unsubscribe", channels: ch }));
      }
      if (newWKey && newW && authReady) {
        const ch = [...walletChannels(newWKey)];
        ws.send(JSON.stringify({ type: "subscribe", channels: ch }));
        subscribedWalletRef.current = newW;
      } else if (!newWKey) {
        subscribedWalletRef.current = null;
      }
      // If auth not ready yet, leave subscribedWalletRef null so a
      // later auth_ok-driven sync picks it up.
    } else if (newWKey && authReady && subscribedWalletRef.current === null) {
      // Auth completed after the initial sync — fire the deferred subscribe now.
      const ch = [...walletChannels(newWKey)];
      ws.send(JSON.stringify({ type: "subscribe", channels: ch }));
      subscribedWalletRef.current = newW;
    }

    if (oldMKey !== newMKey) {
      if (oldMKey && oldM) {
        const ch = [...marketChannels(oldMKey)];
        ws.send(JSON.stringify({ type: "unsubscribe", channels: ch }));
      }
      if (newMKey && newM) {
        const ch = [...marketChannels(newMKey)];
        ws.send(JSON.stringify({ type: "subscribe", channels: ch }));
      }
      subscribedMarketRef.current = newM;
    }
  };

  /** Auth handshake. Tries cached token first, falls back to a signed
   *  EIP-712 prompt. Triggered once per ws.onopen when a wallet is
   *  connected. */
  const runAuthHandshakeRef = useRef<() => Promise<void>>(async () => {});
  runAuthHandshakeRef.current = async () => {
    const ws = wsRef.current;
    const w = walletRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!w) return;
    if (authInFlightRef.current) return;
    authInFlightRef.current = true;

    const cached = getCachedToken(w);
    if (cached) {
      ws.send(JSON.stringify({ type: "auth", token: cached }));
      // auth_ok handler clears authInFlightRef
      return;
    }

    try {
      const timestamp = BigInt(Math.floor(Date.now() / 1000));
      const sessionId = newSessionId();
      const typed = buildWsAuthTypedData({
        wallet: w as `0x${string}`,
        timestamp,
        sessionId,
      });
      const signature = await signTypedDataAsync(typed);
      // The connection might have closed while we waited for the user to
      // sign — the next onopen will retry.
      const sock = wsRef.current;
      if (!sock || sock.readyState !== WebSocket.OPEN) {
        authInFlightRef.current = false;
        return;
      }
      sock.send(
        JSON.stringify({
          type: "auth",
          wallet: w,
          timestamp: Number(timestamp),
          sessionId,
          signature,
        }),
      );
    } catch (err) {
      authInFlightRef.current = false;
      console.warn("[ws] auth signature prompt failed/rejected", err);
    }
  };

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const connect = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      const url = wsStreamUrl();
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectRef.current = 0;
        setWsConnected(true);
        subscribedWalletRef.current = null;
        subscribedMarketRef.current = null;
        authedWalletRef.current = null;
        authInFlightRef.current = false;
        // Public channel — open to all, no auth needed.
        ws.send(JSON.stringify({ type: "subscribe", channels: ["markets"] }));
        // Market channels (orderbook, trades) — public, fire immediately.
        // Wallet-scoped channels are deferred until auth_ok, see
        // syncWalletMarketSubscriptionsRef.
        syncWalletMarketSubscriptionsRef.current(ws);
        // Kick off the auth handshake if a wallet is connected. Cached
        // token replays without prompting; otherwise the user signs
        // once. auth_ok handler retriggers sync to subscribe private.
        if (walletRef.current) {
          void runAuthHandshakeRef.current();
        }
      };

      ws.onmessage = (ev) => {
        handleMessageRef.current(ev);
      };

      ws.onclose = () => {
        setWsConnected(false);
        subscribedWalletRef.current = null;
        subscribedMarketRef.current = null;
        authedWalletRef.current = null;
        authInFlightRef.current = false;
        const attempt = reconnectRef.current;
        reconnectRef.current += 1;
        const exp = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
        const delay = attempt > 12 ? 30_000 : exp;
        timerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      setWsConnected(false);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (marketInvalidateTimerRef.current) clearTimeout(marketInvalidateTimerRef.current);
      marketInvalidateTimerRef.current = null;
      subscribedWalletRef.current = null;
      subscribedMarketRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;
    };
    // Socket lifetime is intentionally tied only to `enabled`. setWsConnected is a stable Jotai setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // If the wallet changed (connect → reconnect-different-wallet) we
    // need to re-auth before the new wallet's private channels can be
    // subscribed. Drop the stale auth flag; sync will skip private
    // subscribes until auth_ok arrives.
    const newWLower = wallet?.toLowerCase() ?? null;
    if (authedWalletRef.current !== null && authedWalletRef.current !== newWLower) {
      authedWalletRef.current = null;
    }
    syncWalletMarketSubscriptionsRef.current(ws);
    if (newWLower && authedWalletRef.current !== newWLower && !authInFlightRef.current) {
      void runAuthHandshakeRef.current();
    }
  }, [wallet, marketAddress, enabled]);
}

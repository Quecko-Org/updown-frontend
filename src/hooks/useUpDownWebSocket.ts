"use client";

import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
// Dogfood our own SDK: the WebSocket transport, auth handshake, token
// replay, reconnect/backoff and subscribe/unsubscribe are ALL owned by
// `@pulsepairs/sdk` now — this hook only maps SDK messages into React
// Query caches and hands the SDK a `signAuth` callback. See
// `sdk/typescript/src/ws.ts`. The previous hand-rolled socket + auth
// state-machine (which duplicated the SDK) has been deleted.
import { UpDownWsClient, type UpDownWsMessage, type WsAuthCredentials } from "@pulsepairs/sdk/ws";
import { buildWsAuthTypedData, freshSessionId } from "@pulsepairs/sdk/eip712";
import {
  addNotificationAtom,
  userSmartAccountClient,
  wsConnectedAtom,
  wsLastEventAtAtom,
} from "@/store/atoms";
import { notificationFromTerminalOrder } from "@/lib/notifications";
import { wsStreamUrl, CHAIN_ID } from "@/lib/env";
import type { BalanceResponse, MarketListItem, OrderBookResponse } from "@/lib/api";
import { applyOrderUpdateToList, buildTerminalOrderToast, type OrderUpdateLike } from "@/lib/derivations";

type WsData = UpDownWsMessage & {
  wallet?: string;
  token?: string;
  expiresAt?: number;
};

/** Keys we accept as a market identifier in the market cache (list uses `address`). */
function matchesMarketKey(m: Partial<MarketListItem> & { marketId?: string }, needle: Partial<MarketListItem> & { marketId?: string }) {
  if (needle.address && m.address) return m.address.toLowerCase() === needle.address.toLowerCase();
  if (needle.marketId && m.marketId) return m.marketId === needle.marketId;
  return false;
}

/** Private channels — require the authed handshake (`connectAuthed`). */
function walletChannels(walletLower: string) {
  return [`orders:${walletLower}`, `balance:${walletLower}`];
}

// --- WS-auth token persistence -------------------------------------------
// The SDK caches its 24h auth token only IN MEMORY (per client instance), so a
// page REFRESH builds a fresh client that re-runs the signAuth handshake. When
// the order session key has lapsed (24h TTL) that handshake falls back to the
// OWNER key → a MetaMask "ReplaySafeHash" popup on every refresh. Mirror the
// server-minted token to localStorage (keyed by wallet) and replay it on load
// so a refresh re-authenticates silently — one signature per 24h, not per
// refresh. A rejected token is purged so we never loop on a stale credential.
const WS_TOKEN_KEY = (walletLower: string) => `updown:wstoken:${walletLower}`;

function readPersistedWsToken(walletLower: string): string | null {
  try {
    const raw = localStorage.getItem(WS_TOKEN_KEY(walletLower));
    if (!raw) return null;
    const { token, expiresAt } = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown };
    if (typeof token !== "string" || typeof expiresAt !== "number") return null;
    // Require > 5 min of remaining life so we don't replay a token about to lapse
    // mid-connect (the SDK stores expiry as ms-epoch, comparable to Date.now()).
    if (expiresAt <= Date.now() + 5 * 60_000) return null;
    return token;
  } catch {
    return null;
  }
}

function persistWsToken(walletLower: string, token: string, expiresAt: number): void {
  try {
    localStorage.setItem(WS_TOKEN_KEY(walletLower), JSON.stringify({ token, expiresAt }));
  } catch {
    /* localStorage unavailable / quota — degrade to per-session (re-sign on refresh). */
  }
}

function clearPersistedWsToken(walletLower: string): void {
  try {
    localStorage.removeItem(WS_TOKEN_KEY(walletLower));
  } catch {
    /* ignore */
  }
}

/**
 * Public per-market channels. The engine keys these by the LOWERCASED
 * composite market key (`settlementAddress-marketId`) — see
 * `MatchingEngine` (`params.market.toLowerCase()`). Callers must pass an
 * already-lowercased key.
 */
function marketChannels(marketLower: string) {
  return [`orderbook:${marketLower}`, `trades:${marketLower}`];
}

/** Strip a `prefix:` channel namespace, returning the key (already lowercased server-side). */
function channelKey(channel: string | undefined, prefix: string): string | null {
  if (!channel || !channel.startsWith(prefix)) return null;
  return channel.slice(prefix.length);
}

/**
 * Subscribes to `/stream` via the SDK's `UpDownWsClient` and merges
 * balance / order-book / order / market / trade updates into React Query.
 *
 * Channels exercised (all five documented public + private channels):
 *   - `markets`                    (public, always)
 *   - `orderbook:<marketKey>`      (public, when a market drawer is focused)
 *   - `trades:<marketKey>`         (public, when a market drawer is focused)
 *   - `orders:<wallet>`            (private, after the SDK auth handshake)
 *   - `balance:<wallet>`           (private, after the SDK auth handshake)
 *
 * The market-scoped channels are added/removed on the LIVE socket via
 * `client.subscribe()` / `unsubscribe()` (no reconnect on drawer changes);
 * wallet identity drives a fresh authed/public connection.
 */
export function useUpDownWebSocket(opts: {
  wallet: string | null | undefined;
  /** Focused market's composite key (`settlementAddress-marketId`); null when no drawer is open. */
  marketAddress: string | null | undefined;
  enabled?: boolean;
}) {
  const { wallet, marketAddress, enabled = true } = opts;
  const queryClient = useQueryClient();
  const setWsConnected = useSetAtom(wsConnectedAtom);
  const setWsLastEventAt = useSetAtom(wsLastEventAtAtom);
  const addNotification = useSetAtom(addNotificationAtom);
  // Account Kit signer — signs the WsAuth handshake as the SCA (ERC-1271).
  const ak = useAtomValue(userSmartAccountClient);

  const walletLower = wallet?.trim() ? wallet.toLowerCase() : null;
  const marketLower = marketAddress?.trim() ? marketAddress.toLowerCase() : null;
  const hasSigner = !!ak;

  // Connection identity. Both "public" states — no wallet, and wallet-present-
  // but-signer-not-ready — collapse to the SAME key so the socket is built at
  // most twice on startup (public → authed once the signer lands), not three
  // times. Only the authed wallet identity forces a reconnect. Used as the
  // sole dep of the client-lifecycle effect below.
  const wantAuthed = !!(walletLower && hasSigner);
  const connKey = !enabled ? "off" : wantAuthed ? `authed:${walletLower}` : "public";

  // Refs so the persistent SDK client's callbacks always see current values
  // without tearing the socket down on every render.
  const walletRef = useRef(walletLower);
  walletRef.current = walletLower;
  const marketRef = useRef(marketLower);
  marketRef.current = marketLower;
  const akRef = useRef(ak);
  akRef.current = ak;

  const clientRef = useRef<UpDownWsClient | null>(null);
  const subscribedMarketRef = useRef<string | null>(null);
  const marketInvalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Message routing (pure app logic). Held in a ref so changes here never
  //     restart the socket. Auth (auth_ok / auth_error) is handled INSIDE the
  //     SDK client and is not forwarded here. ---
  const onMessageRef = useRef<(msg: WsData) => void>(() => {});
  onMessageRef.current = (msg: WsData) => {
    try {
      // Any forwarded frame (the server's `connected` greeting, a
      // `subscribed` ack, or a data event) means the socket is live. The
      // SDK handles auth/reconnect internally and has no open/close callback,
      // so we drive the "live" indicator off message flow; the effect cleanup
      // flips it false on unmount / wallet change, and StatusIndicator treats
      // a stale `wsLastEventAt` as degraded during any reconnect gap.
      setWsConnected(true);
      const w = walletRef.current;

      if (msg.type === "balance_update" && w) {
        const data = msg.data as BalanceResponse;
        queryClient.setQueryData(["balance", w], data);
      }

      if (msg.type === "orderbook_update" && msg.data && typeof msg.data === "object") {
        // The market key comes from the channel (`orderbook:<key>`), which the
        // server already lowercases. Normalize it again anyway: the READERS
        // (OrderBook.tsx / TradeForm.tsx) all key on ["orderbook",
        // marketKey.toLowerCase()], so a snapshot MUST land on the lowercased
        // key or it writes to a sibling cache entry the reader never reads.
        // Fall back to the focused market for any legacy payload without a
        // channel (already lowercased in `marketLower`).
        const rawKey = channelKey(msg.channel, "orderbook:") ?? marketRef.current;
        const mk = rawKey ? rawKey.toLowerCase() : null;
        const d = msg.data as { option?: number; snapshot?: OrderBookResponse["up"] };
        if (mk && (d.option === 1 || d.option === 2) && d.snapshot) {
          const snap = d.snapshot;
          queryClient.setQueryData<OrderBookResponse>(["orderbook", mk], (prev) => {
            // Cold-cache seeding: seed the counterpart side empty so an update
            // arriving before the initial GET /orderbook hydrated isn't dropped.
            const emptySnapshot: OrderBookResponse["up"] = { bids: [], asks: [] };
            const base: OrderBookResponse = prev ?? { up: emptySnapshot, down: emptySnapshot };
            const key = d.option === 1 ? "up" : "down";
            // Last-known-good guard (Issue #2): a fully-empty incoming snapshot
            // (no bids AND no asks) is SUSPECT. The DMM cancel-then-replaces a
            // side, and a single-option frame can arrive before the counterpart
            // rehydrates — either momentarily blanks THIS side, which collapses
            // the synthetic asks the unified book folds from it to empty for a
            // tick. Rather than clobber a populated side to empty, keep the
            // prior value; a genuinely empty book is still caught by the
            // submit-time fresh fetch + walkBook guard in TradeForm.
            const incomingEmpty =
              (snap.bids?.length ?? 0) === 0 && (snap.asks?.length ?? 0) === 0;
            const prevSide = base[key];
            const prevHasContent =
              (prevSide?.bids?.length ?? 0) > 0 || (prevSide?.asks?.length ?? 0) > 0;
            if (incomingEmpty && prevHasContent) return base;
            return { ...base, [key]: snap };
          });
        }
      }

      // `trade` (channel `trades:<key>`): refresh the market's summary (last
      // price / volume) and, if this wallet is a counterparty, its trade
      // history. The book itself already updates via `orderbook_update`.
      if (msg.type === "trade" && msg.data && typeof msg.data === "object") {
        const mk = channelKey(msg.channel, "trades:");
        if (mk) queryClient.invalidateQueries({ queryKey: ["market", mk] });
        const t = msg.data as { buyer?: string; seller?: string };
        if (
          w &&
          (t.buyer?.toLowerCase() === w || t.seller?.toLowerCase() === w)
        ) {
          queryClient.invalidateQueries({ queryKey: ["trades", w] });
        }
      }

      if (msg.type === "market_created" && msg.data && typeof msg.data === "object") {
        // Optimistically prepend the new market so the card appears in ~1ms.
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
        // Flip the in-cache market to RESOLVED so cards stop showing UP/DOWN.
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

      // Real-time spot price updates → append to cached price history (live chart).
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

      // PR-20: per-market Chainlink snapshot pushed by the backend snapshotter.
      // Backend emits Chainlink's raw 8-decimals integer; descale to dollars so
      // cache entries are uniform with the REST payload.
      if (msg.type === "price_snapshot" && msg.data && typeof msg.data === "object") {
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
            queryClient.setQueryData<unknown>(["marketPrices", addr], (prev: unknown) => {
              if (!Array.isArray(prev)) return [[t, priceStr]];
              const filtered = (prev as [number, string][]).filter((row) => row?.[0] !== t);
              return [...filtered, [t, priceStr]];
            });
          }
        }
      }

      if (msg.type === "market_created" || msg.type === "market_resolved") {
        if (marketInvalidateTimerRef.current) clearTimeout(marketInvalidateTimerRef.current);
        marketInvalidateTimerRef.current = setTimeout(() => {
          marketInvalidateTimerRef.current = null;
          queryClient.invalidateQueries({ queryKey: ["markets"] });
          const ma = marketRef.current;
          if (ma) queryClient.invalidateQueries({ queryKey: ["market", ma] });
        }, 1000);
      }

      if (msg.type === "order_update" && msg.data && typeof msg.data === "object") {
        const update = msg.data as OrderUpdateLike;
        // Merge the update into every ["orders", wallet, ...] cache so history /
        // MyOrdersOnMarket reflect fills instantly instead of on the 20s refetch.
        if (w) {
          queryClient.setQueriesData({ queryKey: ["orders", w] }, (old) =>
            applyOrderUpdateToList(old as Parameters<typeof applyOrderUpdateToList>[0], update),
          );
          // A fill moves the settled on-chain balance, but the authoritative
          // balance_update lands at settlement CONFIRMED (seconds later).
          // Refetch the settled balance now so the header updates on the fill.
          if (update.status === "FILLED" || update.status === "PARTIALLY_FILLED") {
            queryClient.invalidateQueries({ queryKey: ["balance", w] });
          }
        }
        const toastMsg = buildTerminalOrderToast(update, w ?? undefined);
        if (toastMsg) {
          if (toastMsg.kind === "info") toast.info(toastMsg.message, { id: toastMsg.id });
          else toast.success(toastMsg.message, { id: toastMsg.id });
        }
        // Persisted bell notification — survives reload, optionally OS push.
        if (
          w &&
          update.id &&
          update.market &&
          update.status &&
          (!update.maker || update.maker.toLowerCase() === w)
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

  // --- signAuth callback for the SDK's authed handshake. Replays a persisted
  //     token first (silent, no signature); only signs fresh when there is no
  //     valid stored token, or when a replayed one was just rejected. ---
  const triedPersistedTokenRef = useRef(false);
  const lastPersistedTokenRef = useRef<string | null>(null);
  const signAuthRef = useRef<() => Promise<WsAuthCredentials>>(async () => {
    throw new Error("signAuth: no wallet");
  });
  signAuthRef.current = async () => {
    const w = walletRef.current;
    if (!w) throw new Error("signAuth: no wallet");
    const walletLower = w.toLowerCase();
    // Replay a persisted token first (once per connect) → refresh re-auths with
    // NO signature prompt. If the server rejects it the SDK clears its cache and
    // calls signAuth again; that second call purges the bad token and signs fresh.
    if (!triedPersistedTokenRef.current) {
      triedPersistedTokenRef.current = true;
      const token = readPersistedWsToken(walletLower);
      if (token) return { token } as unknown as WsAuthCredentials;
    } else {
      clearPersistedWsToken(walletLower);
      lastPersistedTokenRef.current = null;
    }
    const signer = akRef.current;
    if (!signer) throw new Error("signAuth: no signer");
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const sessionId = freshSessionId();
    const typed = buildWsAuthTypedData({
      cfg: { chainId: CHAIN_ID },
      wallet: w as `0x${string}`,
      timestamp,
      sessionId,
    });
    // RAW signature on purpose: pre-onboarding the SCA is counterfactual and the
    // sig comes back 6492-wrapped — the backend's off-chain viem verifyTypedData
    // validates that, so private channels work before the SCA is deployed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signature = (await signer.signTypedDataRaw(typed as any)) as `0x${string}`;
    return { wallet: w as `0x${string}`, timestamp, sessionId, signature };
  };

  // --- Client lifecycle. A fresh client is built whenever the connection MODE
  //     changes: enabled, wallet identity, or signer availability. Focused-market
  //     changes do NOT rebuild — they use subscribe()/unsubscribe() below. ---
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const url = wsStreamUrl();
    // Each fresh client re-tries the persisted token once before signing.
    triedPersistedTokenRef.current = false;
    // Exact canonical SDK client — no local subclass/fork. wsConnected is
    // driven from message flow (see onMessage) since the client exposes no
    // open/close callback. The onMessage wrapper also mirrors the SDK's freshly
    // minted 24h auth token to localStorage so the NEXT page load replays it
    // (no signature prompt). `cachedToken` is private in the SDK type but stable
    // on the instance; read via a typed view so a future SDK rename just no-ops
    // (we'd fall back to re-signing — the pre-fix behaviour, never a break).
    const client = new UpDownWsClient(url, (m) => {
      onMessageRef.current(m as WsData);
      if (!walletLower) return;
      const cache = client as unknown as {
        cachedToken: string | null;
        cachedTokenExpiresAt: number;
      };
      const tok = cache.cachedToken;
      if (tok && tok !== lastPersistedTokenRef.current) {
        lastPersistedTokenRef.current = tok;
        persistWsToken(walletLower, tok, cache.cachedTokenExpiresAt);
      }
    });
    clientRef.current = client;

    const base = ["markets"];
    const market = marketRef.current ? marketChannels(marketRef.current) : [];
    subscribedMarketRef.current = marketRef.current;

    if (walletLower && hasSigner) {
      client.connectAuthed({
        signAuth: () => signAuthRef.current(),
        channels: [...base, ...market, ...walletChannels(walletLower)],
        onAuthError: () => {
          // A rejected signature is terminal for the authed socket (the SDK
          // stops reconnecting). Degrade to public-only on the SAME client so
          // markets / orderbook / trades stay live; private channels are lost
          // until the next wallet/signer change re-triggers the handshake.
          console.warn("[ws] auth rejected; falling back to public channels");
          if (clientRef.current !== client) return;
          const pub = marketRef.current ? marketChannels(marketRef.current) : [];
          client.connectPublic([...base, ...pub]);
          subscribedMarketRef.current = marketRef.current;
        },
      });
    } else {
      client.connectPublic([...base, ...market]);
    }

    return () => {
      setWsConnected(false);
      if (marketInvalidateTimerRef.current) clearTimeout(marketInvalidateTimerRef.current);
      marketInvalidateTimerRef.current = null;
      subscribedMarketRef.current = null;
      client.disconnect();
      if (clientRef.current === client) clientRef.current = null;
    };
    // Socket mode is tied to `connKey` (enabled + authed-wallet-identity),
    // which coalesces the transient wallet-but-no-signer public state so we
    // don't churn an extra connection through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connKey]);

  // --- Focused-market subscription sync on the LIVE client (no reconnect). ---
  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    const prev = subscribedMarketRef.current;
    const next = marketLower;
    if (prev === next) return;
    if (prev) client.unsubscribe(marketChannels(prev));
    if (next) client.subscribe(marketChannels(next));
    subscribedMarketRef.current = next;
  }, [marketLower]);
}

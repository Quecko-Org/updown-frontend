"use client";

import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  wsConnectedAtom,
  wsLastEventAtAtom,
  pendingSignRequestsAtom,
  sessionAmountUsedAtom,
  type PendingSignRequest,
} from "@/store/atoms";
import { wsStreamUrl } from "@/lib/env";
import type { BalanceResponse, MarketListItem, OrderBookResponse } from "@/lib/api";
import { applyOrderUpdateToList, buildTerminalOrderToast, type OrderUpdateLike } from "@/lib/derivations";
import { signUserOpHash } from "@/utils/sessionKeypair";

type WsPayload = {
  type: string;
  channel?: string;
  data?: unknown;
};

/**
 * Shape of `session_sign_request.data` from the backend (matches
 * `WsServer.sendSignRequest` payload in updown-backend). The server
 * validates on its side; we revalidate here to refuse malformed prompts
 * before ever touching the private key.
 */
type SignRequestPayload = {
  requestId: string;
  userOp: { to: string; callData: string; smartAccountAddress: string };
  userOpHash: string;
  expiresAt: number;
};

function isSignRequestPayload(x: unknown): x is SignRequestPayload {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const uo = o.userOp as Record<string, unknown> | undefined;
  return (
    typeof o.requestId === "string" &&
    o.requestId.length > 0 &&
    typeof o.userOpHash === "string" &&
    o.userOpHash.startsWith("0x") &&
    typeof o.expiresAt === "number" &&
    Number.isFinite(o.expiresAt) &&
    !!uo &&
    typeof uo.to === "string" &&
    typeof uo.callData === "string" &&
    typeof uo.smartAccountAddress === "string"
  );
}

/**
 * Sign-request handler invoked from the WS message dispatcher.
 *   1. Revalidate the payload shape — refuse malformed silently.
 *   2. Record the pending request so UI derivations (PENDING chip,
 *      remaining-allowance preview) can react.
 *   3. Show a sonner loading toast keyed by requestId.
 *   4. Sign the userOpHash with the non-extractable P-256 key in IDB.
 *   5. Send `sign_response` back on the same socket.
 *
 * Errors (no key in IDB, signing fails, socket closed mid-flight) surface
 * as a failed toast and leave the pending entry in place — the server
 * will time out the request and retry the settlement on the next tick.
 */
async function handleSessionSignRequest(
  data: unknown,
  deps: {
    ws: WebSocket | null;
    setPendingSignRequests: (updater: (prev: Map<string, PendingSignRequest>) => Map<string, PendingSignRequest>) => void;
    setSessionAmountUsed: (updater: (prev: string) => string) => void;
  }
): Promise<void> {
  if (!isSignRequestPayload(data)) return;

  // Decode the enterPosition amount from calldata: after the 4-byte
  // selector, args are (marketId, option, amount) each uint256-padded.
  // amount is the third word = bytes[4 + 64..4 + 96].
  let amountStr = "0";
  let marketStr = data.userOp.to.toLowerCase();
  let optionNum = 0;
  try {
    const cd = data.userOp.callData.startsWith("0x")
      ? data.userOp.callData.slice(2)
      : data.userOp.callData;
    if (cd.length >= 8 + 3 * 64) {
      marketStr = `0x${cd.slice(8, 8 + 64)}`.replace(/^0x0+/, "0x");
      optionNum = parseInt(cd.slice(8 + 64, 8 + 128), 16) || 0;
      amountStr = BigInt(`0x${cd.slice(8 + 128, 8 + 192)}`).toString();
    }
  } catch {
    // fall through with defaults
  }

  const entry: PendingSignRequest = {
    requestId: data.requestId,
    market: marketStr,
    option: optionNum,
    amount: amountStr,
    expiresAt: data.expiresAt,
  };
  deps.setPendingSignRequests((prev) => new Map(prev).set(data.requestId, entry));

  const amountUsd = (Number(amountStr) / 1_000_000).toFixed(2);
  toast.loading(`Signing fill of $${amountUsd}…`, { id: `sign-${data.requestId}` });

  try {
    const signature = await signUserOpHash(
      data.userOp.smartAccountAddress,
      data.userOpHash
    );
    const ws = deps.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not open when sign_response ready");
    }
    ws.send(
      JSON.stringify({ type: "sign_response", requestId: data.requestId, signature })
    );
    // Running allowance total — updated optimistically here so the UI can
    // reflect the spend even before the ack lands. If routing fails on the
    // server side, we leave the total bumped; the server's retry will
    // regenerate the same requestId (sha256 of the same tuple) and
    // `sign_response_ack` routed:false drops into the noop branch.
    deps.setSessionAmountUsed((prev) => (BigInt(prev) + BigInt(amountStr)).toString());
  } catch (err) {
    console.error("[sessionSign] failed:", err);
    toast.error("Could not sign settlement — re-authorize session", {
      id: `sign-${data.requestId}`,
    });
  }
}

/** Keys we accept as a market identifier in the market cache (list uses `address`). */
function matchesMarketKey(m: Partial<MarketListItem> & { marketId?: string }, needle: Partial<MarketListItem> & { marketId?: string }) {
  if (needle.address && m.address) return m.address.toLowerCase() === needle.address.toLowerCase();
  if (needle.marketId && m.marketId) return m.marketId === needle.marketId;
  return false;
}

function walletChannels(walletLower: string) {
  // Option C: subscribe to `sessionSign:<wallet>` unconditionally even when
  // the flag is off — it's server-gated (backend never pushes to this
  // channel without OPTION_C_ENABLED=1), and subscribing always keeps the
  // list stable across flag flips without a reconnect.
  return [
    `orders:${walletLower}`,
    `balance:${walletLower}`,
    `sessionSign:${walletLower}`,
  ] as const;
}

function marketChannels(marketLower: string) {
  return [`orderbook:${marketLower}`, `trades:${marketLower}`] as const;
}

/**
 * Subscribes to `/stream`. Merges balance + order book updates into React Query.
 * Market list updates come from debounced invalidation on WS events plus focus refetch.
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
  const setPendingSignRequests = useSetAtom(pendingSignRequestsAtom);
  const setSessionAmountUsed = useSetAtom(sessionAmountUsedAtom);
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

  const handleMessageRef = useRef<(ev: MessageEvent) => void>(() => {});

  handleMessageRef.current = (ev: MessageEvent) => {
    try {
      const msg = JSON.parse(String(ev.data)) as WsPayload;
      const w = walletRef.current;
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
      if (msg.type === "session_sign_request" && msg.data && typeof msg.data === "object") {
        void handleSessionSignRequest(msg.data as SignRequestPayload, {
          ws: wsRef.current,
          setPendingSignRequests,
          setSessionAmountUsed,
        });
      }
      if (msg.type === "sign_response_ack" && typeof (msg as unknown as { requestId?: string }).requestId === "string") {
        const ack = msg as unknown as { requestId: string; routed?: boolean };
        const rid = ack.requestId;
        const routed = ack.routed;
        // Only drop the pending-request entry when the server confirms the
        // signature was accepted. If `routed:false` (late / duplicate) we
        // leave the entry so the user still sees the toast until it expires.
        if (routed) {
          setPendingSignRequests((prev) => {
            if (!prev.has(rid)) return prev;
            const next = new Map(prev);
            next.delete(rid);
            return next;
          });
          toast.success("Fill settled", { id: `sign-${rid}` });
        }
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

    if (oldWKey !== newWKey) {
      if (oldWKey && oldW) {
        const ch = [...walletChannels(oldWKey)];
        ws.send(JSON.stringify({ type: "unsubscribe", channels: ch, wallet: oldW }));
      }
      if (newWKey && newW) {
        const ch = [...walletChannels(newWKey)];
        ws.send(JSON.stringify({ type: "subscribe", channels: ch, wallet: newW }));
      }
      subscribedWalletRef.current = newW;
    }

    if (oldMKey !== newMKey) {
      if (oldMKey && oldM) {
        const ch = [...marketChannels(oldMKey)];
        ws.send(JSON.stringify({ type: "unsubscribe", channels: ch, wallet: undefined }));
      }
      if (newMKey && newM) {
        const ch = [...marketChannels(newMKey)];
        ws.send(JSON.stringify({ type: "subscribe", channels: ch, wallet: newW ?? undefined }));
      }
      subscribedMarketRef.current = newM;
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
        ws.send(JSON.stringify({ type: "subscribe", channels: ["markets"], wallet: undefined }));
        syncWalletMarketSubscriptionsRef.current(ws);
      };

      ws.onmessage = (ev) => {
        handleMessageRef.current(ev);
      };

      ws.onclose = () => {
        setWsConnected(false);
        subscribedWalletRef.current = null;
        subscribedMarketRef.current = null;
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
    syncWalletMarketSubscriptionsRef.current(ws);
  }, [wallet, marketAddress, enabled]);
}

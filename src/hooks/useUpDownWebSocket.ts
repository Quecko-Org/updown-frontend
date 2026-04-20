"use client";

import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { wsConnectedAtom, wsLastEventAtAtom } from "@/store/atoms";
import { wsStreamUrl } from "@/lib/env";
import type { BalanceResponse, MarketListItem, OrderBookResponse } from "@/lib/api";
import { buildTerminalOrderToast, type OrderUpdateLike } from "@/lib/derivations";

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
  return [`orders:${walletLower}`, `balance:${walletLower}`] as const;
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
      if (msg.type === "order_update" && msg.data && typeof msg.data === "object") {
        const t = buildTerminalOrderToast(msg.data as OrderUpdateLike, w);
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

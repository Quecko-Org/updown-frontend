"use client";

import { useEffect, useRef, useCallback } from "react";
import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { wsConnectedAtom, wsLastEventAtAtom } from "@/store/atoms";
import { wsStreamUrl } from "@/lib/env";
import type { BalanceResponse, OrderBookResponse } from "@/lib/api";

type WsPayload = {
  type: string;
  channel?: string;
  data?: unknown;
};

/**
 * Subscribes to `/stream`. Merges balance + order book updates into React Query.
 * Until the backend reliably broadcasts market events, pages also poll `GET /markets` and `GET /balance/:wallet`.
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

  const handleMessage = useCallback(
    (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(String(ev.data)) as WsPayload;
        if (msg.type === "balance_update" && wallet) {
          const data = msg.data as BalanceResponse;
          queryClient.setQueryData(["balance", wallet.toLowerCase()], data);
        }
        if (msg.type === "orderbook_update" && marketAddress && msg.data && typeof msg.data === "object") {
          const d = msg.data as { option?: number; snapshot?: OrderBookResponse["up"] };
          if (d.option === 1 || d.option === 2) {
            queryClient.setQueryData<OrderBookResponse>(["orderbook", marketAddress.toLowerCase()], (prev) => {
              if (!prev) return prev;
              const key = d.option === 1 ? "up" : "down";
              return { ...prev, [key]: d.snapshot ?? prev[key] };
            });
          }
        }
        if (msg.type === "market_created" || msg.type === "market_resolved") {
          queryClient.invalidateQueries({ queryKey: ["markets"] });
          if (marketAddress) {
            queryClient.invalidateQueries({ queryKey: ["market", marketAddress.toLowerCase()] });
          }
        }
        setWsLastEventAt(Date.now());
      } catch {
        /* ignore */
      }
    },
    [queryClient, wallet, marketAddress, setWsLastEventAt]
  );

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
        const channels: string[] = ["markets"];
        if (marketAddress) {
          const m = marketAddress.toLowerCase();
          channels.push(`orderbook:${m}`, `trades:${m}`);
        }
        if (wallet) {
          const w = wallet.toLowerCase();
          channels.push(`orders:${w}`, `balance:${w}`);
        }
        ws.send(JSON.stringify({ type: "subscribe", channels, wallet: wallet ?? undefined }));
      };

      ws.onmessage = handleMessage;

      ws.onclose = () => {
        setWsConnected(false);
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
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [enabled, wallet, marketAddress, handleMessage, setWsConnected]);
}

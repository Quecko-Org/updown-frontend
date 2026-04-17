"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

const BINANCE_WS = "wss://stream.binance.com:9443/ws";

const SYMBOL_MAP: Record<string, string> = {
  BTC: "btcusdt",
  ETH: "ethusdt",
};

/**
 * Connects to Binance public WebSocket for live trade prices.
 * Appends a new point to the React Query `["priceHistory", symbol]` cache
 * at most once per second so the chart updates in real time.
 */
export function useLivePriceFeed(symbols: string[]) {
  const qc = useQueryClient();
  const lastPushRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!symbols.length || typeof window === "undefined") return;

    const streams = symbols
      .map((s) => SYMBOL_MAP[s])
      .filter(Boolean)
      .map((s) => `${s}@trade`);

    if (!streams.length) return;

    const url = `${BINANCE_WS}/${streams.join("/")}`;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    function connect() {
      ws = new WebSocket(url);

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as {
            s?: string; // e.g. "BTCUSDT"
            p?: string; // price
            T?: number; // trade time ms
          };
          if (!msg.s || !msg.p) return;

          const sym = msg.s.endsWith("USDT")
            ? msg.s.replace("USDT", "")
            : msg.s;

          // Throttle: max 1 push per second per symbol
          const now = Date.now();
          const lastPush = lastPushRef.current[sym] ?? 0;
          if (now - lastPush < 1000) return;
          lastPushRef.current[sym] = now;

          const price = Number(msg.p);
          const timeMs = msg.T ?? now;
          if (!Number.isFinite(price) || price <= 0) return;

          // Append to React Query cache
          qc.setQueryData<unknown>(["priceHistory", sym], (prev: unknown) => {
            if (!Array.isArray(prev)) return prev;
            return [...prev, [timeMs, String(price)]];
          });
        } catch {
          /* ignore malformed messages */
        }
      };

      ws.onopen = () => {
        attempt = 0;
      };

      ws.onclose = () => {
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      ws = null;
    };
  }, [symbols.join(","), qc]); // eslint-disable-line react-hooks/exhaustive-deps
}

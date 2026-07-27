"use client";

import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { wsLastEventAtAtom } from "@/store/atoms";

/**
 * True when the WebSocket is actively delivering events (last event within
 * `freshMs`). The always-on `markets` channel streams `price_snapshot`
 * frames continuously, so a fresh `wsLastEventAt` is a reliable proxy for
 * "the socket is up and this tab is receiving" — and it self-heals: if the
 * socket drops, frames stop, `wsLastEventAt` goes stale, and callers that
 * gate polling on this fall back to REST automatically.
 *
 * Used to suppress redundant REST polling for data the WS already pushes
 * (the order book and the market list). Re-evaluates on a 2s tick so the
 * fall-back kicks in within a few seconds of a socket drop.
 */
export function useWsLive(freshMs = 8_000): boolean {
  const last = useAtomValue(wsLastEventAtAtom);
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 2_000);
    return () => clearInterval(id);
  }, []);
  // now === 0 only before the first client effect runs (and during SSR) —
  // treat that as "not live" so we default to polling until proven otherwise.
  return last != null && now > 0 && now - last < freshMs;
}

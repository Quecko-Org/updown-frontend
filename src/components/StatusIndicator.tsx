"use client";

import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { wsConnectedAtom, wsLastEventAtAtom } from "@/store/atoms";
import { API_BASE } from "@/lib/env";

/**
 * Header status dot. Polls `/health` every 30s; combines with
 * `wsConnectedAtom` for the at-a-glance system-status answer.
 *
 *  - green:  REST OK + WS connected (or no WS subscription required)
 *  - yellow: WS disconnected for > 60s, but REST still OK
 *  - red:    REST /health failed twice in a row
 *
 * Pure UI — no actions on click. Tooltip explains state. Keep it cheap;
 * polling /health has zero rate-limit weight and the WS check is just
 * reading two atoms.
 */
type Severity = "ok" | "warn" | "down";

const POLL_MS = 30_000;
const WS_STALE_MS = 60_000;

export function StatusIndicator() {
  const wsConnected = useAtomValue(wsConnectedAtom);
  const wsLastEventAt = useAtomValue(wsLastEventAtAtom);

  const [restOk, setRestOk] = useState<boolean | null>(null);
  const [restFailStreak, setRestFailStreak] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch(`${API_BASE}/health`, { cache: "no-store" });
        const ok = res.ok;
        if (cancelled) return;
        setRestOk(ok);
        setRestFailStreak((s) => (ok ? 0 : s + 1));
      } catch {
        if (cancelled) return;
        setRestOk(false);
        setRestFailStreak((s) => s + 1);
      }
    }
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const wsStaleMs =
    wsLastEventAt != null ? Date.now() - wsLastEventAt : null;
  const wsHealthy =
    wsConnected && (wsStaleMs == null || wsStaleMs < WS_STALE_MS);

  let severity: Severity;
  let label: string;
  if (restOk === false && restFailStreak >= 2) {
    severity = "down";
    label = "API unavailable — retrying.";
  } else if (!wsHealthy && restOk !== false) {
    severity = "warn";
    label = wsConnected
      ? `Live updates lagging (${wsStaleMs ? Math.round(wsStaleMs / 1000) : "?"}s since last event).`
      : "Reconnecting to live updates…";
  } else if (restOk === null) {
    severity = "warn";
    label = "Checking system status…";
  } else {
    severity = "ok";
    label = "All systems operational.";
  }

  const color =
    severity === "ok"
      ? "var(--up)"
      : severity === "warn"
        ? "oklch(78% 0.16 80)" // amber
        : "var(--down)";

  return (
    <span
      className="inline-flex items-center"
      role="status"
      aria-label={label}
      title={label}
      style={{ width: 10, height: 10 }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow:
            severity === "ok"
              ? `0 0 0 2px oklch(74% 0.18 155 / 0.18)`
              : "none",
        }}
      />
    </span>
  );
}

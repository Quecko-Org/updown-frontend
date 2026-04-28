"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { getMarkets, type MarketListItem, type PairSymbol } from "@/lib/api";
import { marketPathFromAddress } from "@/lib/marketKey";
import { cn } from "@/lib/cn";

/**
 * Phase2-F: always-visible quick-nav for the 6 active live markets
 * (BTC + ETH × 5/15/60 min). Polymarket-parity — one click to jump
 * between live markets without bouncing through the home page.
 *
 * Implementation notes:
 *  - Reuses the home page's `["markets", tf, pair]` query keys so React
 *    Query dedupes — no extra network cost when the home view is already
 *    fetching the same data.
 *  - Countdown ticks once per second per chip; we keep one timer at the
 *    strip level and re-render all chips together to avoid 6 timers.
 *  - Hides itself completely while data is loading so the layout doesn't
 *    shift under the user. Once at least one market resolves, every
 *    timeframe slot renders (greyed + "—" if that slot has no active
 *    market — vanishingly rare in practice).
 */

const PAIRS: PairSymbol[] = ["BTC-USD", "ETH-USD"];
const TFS: (300 | 900 | 3600)[] = [300, 900, 3600];

function tfShort(tf: number): string {
  if (tf === 300) return "5m";
  if (tf === 900) return "15m";
  return "1h";
}

function pairShort(pair: PairSymbol): string {
  return pair === "BTC-USD" ? "BTC" : "ETH";
}

function pickActive(list: MarketListItem[] | undefined): MarketListItem | null {
  if (!list?.length) return null;
  return list.find((m) => m.status === "ACTIVE") ?? null;
}

function formatCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return "0:00";
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function QuickMarketsStrip() {
  const pathname = usePathname();
  const queries = useQueries({
    queries: PAIRS.flatMap((pair) =>
      TFS.map((tf) => ({
        queryKey: ["markets", tf, pair],
        queryFn: () => getMarkets(tf, pair),
        staleTime: 30_000,
        refetchInterval: 60_000,
      })),
    ),
  });

  // One shared 1Hz tick → all chip countdowns recompute together.
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const slots = useMemo(() => {
    const out: {
      pair: PairSymbol;
      tf: number;
      market: MarketListItem | null;
    }[] = [];
    for (let p = 0; p < PAIRS.length; p++) {
      for (let t = 0; t < TFS.length; t++) {
        const idx = p * TFS.length + t;
        out.push({
          pair: PAIRS[p]!,
          tf: TFS[t]!,
          market: pickActive(queries[idx]?.data),
        });
      }
    }
    return out;
  }, [queries]);

  const anyLoaded = slots.some((s) => s.market != null);
  if (!anyLoaded) return null;

  // Active path detection: matches the current market in the URL so the
  // chip pointing at the same address renders highlighted.
  const currentMarketKey = (() => {
    const m = pathname?.match(/^\/market\/([^/?#]+)/);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]!).toLowerCase();
    } catch {
      return m[1]!.toLowerCase();
    }
  })();

  return (
    <nav
      aria-label="Quick markets"
      className="pp-quicknav"
      style={{ borderColor: "var(--border-0)" }}
    >
      <div className="pp-quicknav__inner">
        <span className="pp-micro pp-quicknav__label">Live</span>
        <div className="pp-quicknav__chips">
          {slots.map(({ pair, tf, market }) => {
            const tfLabel = tfShort(tf);
            const pairLabel = pairShort(pair);
            const id = `${pair}-${tf}`;
            if (!market) {
              return (
                <span
                  key={id}
                  className={cn("pp-quicknav__chip", "pp-quicknav__chip--off")}
                  aria-disabled="true"
                  title={`No live ${pairLabel} ${tfLabel} market`}
                >
                  <span className="pp-quicknav__pair">{pairLabel}</span>
                  <span className="pp-quicknav__tf">{tfLabel}</span>
                  <span className="pp-quicknav__cd pp-tabular">—</span>
                </span>
              );
            }
            const left = Math.max(0, market.endTime - now);
            const cdLabel = formatCountdown(left);
            const urgent = left > 0 && left < 60;
            const active = currentMarketKey === market.address.toLowerCase();
            return (
              <Link
                key={id}
                href={marketPathFromAddress(market.address)}
                className={cn(
                  "pp-quicknav__chip",
                  active && "pp-quicknav__chip--on",
                  urgent && "pp-quicknav__chip--urgent",
                )}
                aria-current={active ? "page" : undefined}
                title={`${pairLabel}/USD · ${tfLabel} · ${cdLabel} remaining`}
              >
                <span className="pp-quicknav__pair">{pairLabel}</span>
                <span className="pp-quicknav__tf">{tfLabel}</span>
                <span className="pp-quicknav__cd pp-tabular">{cdLabel}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

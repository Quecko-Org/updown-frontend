"use client";

import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { getMarkets, type MarketListItem } from "@/lib/api";
import { marketDurationLabel } from "@/lib/format";
import { marketPathFromAddress } from "@/lib/marketKey";

/**
 * Phase2-B right-rail cross-promo card list. Shows up to 3 alternative live
 * markets so a user landing on a resolved market can jump straight into
 * something they can actually trade. Selection rules:
 *
 *   1. Same pair, other timeframes (BTC 5m → BTC 15m, BTC 1h)
 *   2. Same timeframe, other pairs (BTC 5m → ETH 5m)
 *
 * Filtered to ACTIVE markets only — anything else can't be traded so
 * surfacing it would just bounce the user back to another closed page.
 */
const TFS = [300, 900, 3600] as const;
const PAIRS = ["BTC-USD", "ETH-USD"] as const;

type Pair = (typeof PAIRS)[number];
type Tf = (typeof TFS)[number];

export function CrossPromoCards({
  currentPair,
  currentDuration,
}: {
  currentPair: string;
  currentDuration: number;
}) {
  // Fetch active markets across the full pair × tf grid (6 small queries,
  // already cached at the home page level so most hits are warm).
  const queries = useQueries({
    queries: PAIRS.flatMap((pair) =>
      TFS.map((tf) => ({
        queryKey: ["markets", tf, pair] as const,
        queryFn: () => getMarkets(tf, pair),
        staleTime: 30_000,
      })),
    ),
  });

  const allActive: MarketListItem[] = [];
  let qi = 0;
  for (const pair of PAIRS) {
    for (const tf of TFS) {
      const data = queries[qi]?.data ?? [];
      const active = data.find((m) => m.status === "ACTIVE");
      if (
        active &&
        // Skip the current market — we wouldn't promote the page back to itself.
        !(pair === currentPair && tf === currentDuration)
      ) {
        allActive.push(active);
      }
      qi += 1;
    }
  }

  // Order: same-pair-other-tf first, then other-pair-same-tf, then everything else.
  const ranked = [
    ...allActive.filter(
      (m) => m.pairId === currentPair && m.duration !== currentDuration,
    ),
    ...allActive.filter(
      (m) => m.pairId !== currentPair && m.duration === currentDuration,
    ),
    ...allActive.filter(
      (m) => m.pairId !== currentPair && m.duration !== currentDuration,
    ),
  ];
  const picks = ranked.slice(0, 3);
  if (picks.length === 0) return null;

  return (
    <aside className="pp-xpromo">
      <span className="pp-xpromo__title">Other live markets</span>
      <div className="pp-xpromo__list">
        {picks.map((m) => (
          <CrossPromoCard key={m.address} market={m} />
        ))}
      </div>
    </aside>
  );
}

function CrossPromoCard({ market }: { market: MarketListItem }) {
  const pairBase = (market.pairSymbol ?? market.pairId).split("-")[0] ?? "BTC";
  const tfLabel = marketDurationLabel(market.duration);
  const upPrice = Number(market.upPrice);
  const downPrice = Number(market.downPrice);
  const total = upPrice + downPrice;
  const upPct =
    Number.isFinite(upPrice) && Number.isFinite(downPrice) && total > 0
      ? Math.round((upPrice / total) * 100)
      : null;

  return (
    <Link
      href={marketPathFromAddress(market.address)}
      className="pp-xpromo__card"
      aria-label={`Open ${pairBase}/USD ${tfLabel} live market`}
    >
      <span className="flex flex-col gap-0.5">
        <span className="pp-xpromo__pair">{pairBase}/USD</span>
        <span className="pp-xpromo__tf">{tfLabel}</span>
      </span>
      <span className="pp-xpromo__chip">
        {upPct == null ? "—" : `UP ${upPct}%`}
      </span>
    </Link>
  );
}

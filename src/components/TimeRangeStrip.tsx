"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMarkets, type MarketListItem } from "@/lib/api";
import { marketPathFromAddress } from "@/lib/marketKey";
import { cn } from "@/lib/cn";

/**
 * Polymarket-parity outcome strip below the chart.
 *
 * Layout:
 *   [past N: colored dots, clickable] → [current: highlighted] → [future N: labels]
 *
 * Colors:
 *   green ▲ = UP won, red ▼ = DOWN won, gray = unresolved/awaiting
 *
 * Counts depend on duration:
 *   5-min markets:  6 past + 1 current + 6 future
 *   15-min and 1-h: 4 past + 1 current + 4 future
 *
 * Past windows are real markets pulled from /markets and clickable.
 * Future windows are projected from the current time aligned to duration
 * boundaries (cron creates markets at top-of-window) and shown as labels —
 * they don't exist yet on chain so they have no detail page to link to.
 */
export function TimeRangeStrip({
  pairId,
  duration,
  currentMarketAddress,
}: {
  pairId: string;
  duration: number;
  currentMarketAddress: string;
}) {
  const validTfQuery = duration === 300 || duration === 900 || duration === 3600;
  const tfNarrow = duration as 300 | 900 | 3600;
  const pairNarrow = pairId as "BTC-USD" | "ETH-USD";

  const { data: markets } = useQuery({
    queryKey: ["markets", duration, pairId],
    queryFn: () => getMarkets(tfNarrow, pairNarrow),
    staleTime: 30_000,
    enabled: validTfQuery,
  });

  const past = duration === 300 ? 6 : 4;
  const future = duration === 300 ? 6 : 4;

  const slots = useMemo(
    () => buildSlots(markets ?? [], currentMarketAddress, duration, past, future),
    [markets, currentMarketAddress, duration, past, future],
  );

  if (!validTfQuery) return null;

  return (
    <div className="pp-tr-strip" role="navigation" aria-label="Market outcome history">
      <div className="pp-tr-strip__inner">
        {slots.map((s, i) => (
          <SlotPill key={`${s.kind}-${s.label}-${i}`} slot={s} />
        ))}
      </div>
    </div>
  );
}

type Slot =
  | {
      kind: "past";
      label: string;
      winnerSide: 1 | 2 | null;
      href: string;
    }
  | {
      kind: "current";
      label: string;
      href: string;
    }
  | {
      kind: "future";
      label: string;
    };

function SlotPill({ slot }: { slot: Slot }) {
  if (slot.kind === "current") {
    return (
      <Link href={slot.href} className="pp-tr-strip__slot pp-tr-strip__slot--current">
        <span className="pp-tr-strip__dot pp-tr-strip__dot--current" />
        <span className="pp-tr-strip__label">{slot.label}</span>
      </Link>
    );
  }
  if (slot.kind === "past") {
    const isUp = slot.winnerSide === 1;
    const isDown = slot.winnerSide === 2;
    return (
      <Link
        href={slot.href}
        className={cn(
          "pp-tr-strip__slot pp-tr-strip__slot--past",
          isUp && "pp-tr-strip__slot--up",
          isDown && "pp-tr-strip__slot--down",
        )}
        title={
          isUp
            ? "UP won"
            : isDown
              ? "DOWN won"
              : "Awaiting settlement"
        }
      >
        <span
          className={cn(
            "pp-tr-strip__dot",
            isUp && "pp-tr-strip__dot--up",
            isDown && "pp-tr-strip__dot--down",
          )}
        >
          {isUp ? "▲" : isDown ? "▼" : "·"}
        </span>
        <span className="pp-tr-strip__label">{slot.label}</span>
      </Link>
    );
  }
  return (
    <div
      className="pp-tr-strip__slot pp-tr-strip__slot--future"
      aria-label={`Upcoming window: ${slot.label}`}
    >
      <span className="pp-tr-strip__dot pp-tr-strip__dot--future" />
      <span className="pp-tr-strip__label">{slot.label}</span>
    </div>
  );
}

function formatTimeLabel(unixSec: number, duration: number): string {
  const d = new Date(unixSec * 1000);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  if (duration < 3600) return `${hh}:${mm}`;
  // 1h+ markets — show hour only since minute is always :00 at boundary.
  return `${hh}:${mm}`;
}

function buildSlots(
  markets: MarketListItem[],
  currentAddress: string,
  duration: number,
  pastCount: number,
  futureCount: number,
): Slot[] {
  const sorted = [...markets].sort((a, b) => a.endTime - b.endTime);
  const currentIdx = sorted.findIndex(
    (m) => m.address.toLowerCase() === currentAddress.toLowerCase(),
  );

  const pastSlice =
    currentIdx >= 0
      ? sorted.slice(Math.max(0, currentIdx - pastCount), currentIdx)
      : sorted.filter((m) => m.status === "RESOLVED" || m.status === "CLAIMED").slice(-pastCount);

  const past: Slot[] = pastSlice.map((m) => ({
    kind: "past" as const,
    label: formatTimeLabel(m.endTime, duration),
    winnerSide: m.winner === 1 ? 1 : m.winner === 2 ? 2 : null,
    href: marketPathFromAddress(m.address),
  }));

  const currentMarket = currentIdx >= 0 ? sorted[currentIdx] : null;
  const current: Slot[] = currentMarket
    ? [
        {
          kind: "current" as const,
          label: formatTimeLabel(currentMarket.endTime, duration),
          href: marketPathFromAddress(currentMarket.address),
        },
      ]
    : [];

  // Future windows — predicted from cron schedule. Markets exist on cron
  // boundaries (top-of-5min, top-of-15min, top-of-hour). The strip shows
  // these as labels since the markets aren't on chain yet.
  const lastEnd = currentMarket?.endTime ?? Math.floor(Date.now() / 1000);
  const future: Slot[] = Array.from({ length: futureCount }, (_, i) => ({
    kind: "future" as const,
    label: formatTimeLabel(lastEnd + (i + 1) * duration, duration),
  }));

  return [...past, ...current, ...future];
}

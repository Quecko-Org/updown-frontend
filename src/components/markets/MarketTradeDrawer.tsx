"use client";

import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMarket, type MarketDetail, type MarketListItem } from "@/lib/api";
import { TradeForm } from "@/components/TradeForm";
import { formatStrikeUsd, marketDurationLabel } from "@/lib/format";

type Props = {
  marketAddress: string | null;
  onClose: () => void;
};

export function MarketTradeDrawer({ marketAddress, onClose }: Props) {
  const open = marketAddress != null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const queryClient = useQueryClient();

  // Seed the header from the markets-list cache the row was clicked from, so
  // the drawer shows the real pair + strike immediately instead of flashing
  // "Loading… / Strike —" while GET /markets/:addr is in flight — the data is
  // already on screen in the list. `placeholderData` (not `initialData`) keeps
  // this observer-local: the full detail (order book, timeRemaining) still
  // fetches in the background and TradeForm's own ["market"] cache is untouched.
  const listSeed = useMemo<MarketDetail | undefined>(() => {
    if (!marketAddress) return undefined;
    const target = marketAddress.toLowerCase();
    for (const [, list] of queryClient.getQueriesData<MarketListItem[]>({
      queryKey: ["markets"],
    })) {
      const hit = Array.isArray(list)
        ? list.find((m) => m?.address?.toLowerCase() === target)
        : undefined;
      if (hit) {
        return {
          ...hit,
          timeRemainingSeconds: Math.max(0, hit.endTime - Math.floor(Date.now() / 1000)),
          orderBook: {
            up: { bestBid: null, bestAsk: null },
            down: { bestBid: null, bestAsk: null },
          },
        };
      }
    }
    return undefined;
  }, [marketAddress, queryClient]);

  const { data: market } = useQuery({
    queryKey: ["market", marketAddress?.toLowerCase() ?? ""],
    queryFn: () => getMarket(marketAddress as string),
    enabled: open,
    refetchInterval: open ? 15_000 : false,
    placeholderData: listSeed,
  });

  if (!open) return null;

  const pairBase =
    (market?.pairSymbol ?? market?.pairId ?? "BTC-USD").split("-")[0] ?? "BTC";
  const heroTitle = market
    ? `${pairBase}/USD · ${marketDurationLabel(market.duration)}`
    : "Loading…";
  const strikeLabel = market
    ? formatStrikeUsd(market.strikePrice, market.strikeDecimals)
    : "—";

  return (
    <div
      className="pp-trade-drawer-root"
      role="dialog"
      aria-modal="true"
      aria-label={`Trade ${heroTitle}`}
    >
      <div
        className="pp-trade-drawer-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="pp-trade-drawer-panel">
        <header className="pp-trade-drawer-header">
          <div className="pp-trade-drawer-title">
            <span className="pp-trade-drawer-title-main">{heroTitle}</span>
            <span className="pp-trade-drawer-title-sub">Strike {strikeLabel}</span>
          </div>
          <button
            type="button"
            className="pp-trade-drawer-close"
            onClick={onClose}
            aria-label="Close trade panel"
          >
            ✕
          </button>
        </header>
        <div className="pp-trade-drawer-body">
          {marketAddress ? <TradeForm marketAddress={marketAddress} /> : null}
        </div>
      </aside>
    </div>
  );
}

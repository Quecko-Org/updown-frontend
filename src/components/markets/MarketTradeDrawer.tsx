"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMarket } from "@/lib/api";
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

  const { data: market } = useQuery({
    queryKey: ["market", marketAddress?.toLowerCase() ?? ""],
    queryFn: () => getMarket(marketAddress as string),
    enabled: open,
    refetchInterval: open ? 15_000 : false,
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

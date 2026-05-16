"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { MarketListItem } from "@/lib/api";
import { MAX_STAKE_USDT, MIN_STAKE_USDT } from "@/lib/stakeBounds";
import { formatStrikeUsd } from "@/lib/format";

export type TradeSide = "up" | "down";

export type TradeDrawerProps = {
  market: MarketListItem;
  initialSide: TradeSide;
  asset: "btc" | "eth";
  /** Total platform + maker fee in bps. Default 150 (= 70 platform + 80 maker, the dev config). */
  totalFeeBps?: number;
  onClose: () => void;
  /**
   * Fires when the user submits a valid stake. PR-3 leaves this as a
   * callback; PR-4 wires it through to the EIP-712 sign + POST /orders
   * flow. Today it's an inert button so we can ship the UI without
   * blocking on the trade-submission rebuild.
   */
  onSubmit: (input: { side: TradeSide; stakeUsd: number }) => void;
};

const QUICK_PICKS: ReadonlyArray<{ label: string; value: number | "max" }> = [
  { label: "$5", value: 5 },
  { label: "$25", value: 25 },
  { label: "$100", value: 100 },
  { label: "Max", value: "max" },
];

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function timeRange(startSec: number, endSec: number): string {
  const start = new Date(startSec * 1000);
  const end = new Date(endSec * 1000);
  const full = end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  const [h, m] = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: false }).split(":");
  const hourNum = ((Number(h) + 11) % 12) + 1;
  return `${hourNum}:${m} – ${full}`;
}

function resolveTimeUtc(endSec: number): string {
  const d = new Date(endSec * 1000);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

function priceToCents(raw: string): number {
  // upPrice / downPrice from MarketListItem are basis-points strings ("5400" = 54¢).
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.round(n / 100);
}

export function TradeDrawer({
  market,
  initialSide,
  asset,
  totalFeeBps = 150,
  onClose,
  onSubmit,
}: TradeDrawerProps) {
  const [side, setSide] = useState<TradeSide>(initialSide);
  const [stakeInput, setStakeInput] = useState<string>("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const stakeInputRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Focus the stake input on open so users land in the typing position
  // immediately. Esc closes from anywhere inside the drawer.
  useEffect(() => {
    stakeInputRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const upCents = priceToCents(market.upPrice);
  const downCents = priceToCents(market.downPrice);
  const selectedCents = side === "up" ? upCents : downCents;

  const stakeUsd = Number(stakeInput);
  const stakeValid = Number.isFinite(stakeUsd) && stakeUsd >= MIN_STAKE_USDT && stakeUsd <= MAX_STAKE_USDT;
  const stakeError = useMemo(() => {
    if (stakeInput === "") return null;
    if (!Number.isFinite(stakeUsd)) return "Enter a valid amount";
    if (stakeUsd < MIN_STAKE_USDT) return `Minimum stake is $${MIN_STAKE_USDT}`;
    if (stakeUsd > MAX_STAKE_USDT) return `Maximum stake is $${MAX_STAKE_USDT}`;
    return null;
  }, [stakeInput, stakeUsd]);

  // Trade math — keep it self-contained. fee = stake × bps; net = stake − fee;
  // shares = net / (price/100); payout = shares × $1; toWin = payout − stake.
  const summary = useMemo(() => {
    const stake = stakeValid ? stakeUsd : 0;
    const feeUsd = stake * (totalFeeBps / 10_000);
    const netUsd = stake - feeUsd;
    const sharePriceUsd = selectedCents / 100;
    const shares = sharePriceUsd > 0 ? netUsd / sharePriceUsd : 0;
    const payoutUsd = shares; // each share pays out $1 on win
    const toWinUsd = payoutUsd - stake;
    return {
      youSpend: fmtMoney(stake),
      sharesAcquired: shares.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      fees: fmtMoney(feeUsd),
      payoutIfWin: fmtMoney(payoutUsd),
      toWin: fmtMoney(toWinUsd),
    };
  }, [selectedCents, stakeUsd, stakeValid, totalFeeBps]);

  const handleQuickPick = useCallback((value: number | "max") => {
    if (value === "max") {
      setStakeInput(String(MAX_STAKE_USDT));
    } else {
      setStakeInput(String(value));
    }
  }, []);

  const handleSubmit = () => {
    if (!stakeValid) return;
    onSubmit({ side, stakeUsd });
  };

  const submitClass = `pp-btn pp-btn--lg ${side === "up" ? "pp-btn--up" : "pp-btn--down"}`;
  const submitLabel = stakeValid
    ? `Bet $${stakeUsd} on ${side.toUpperCase()}`
    : `Bet on ${side.toUpperCase()}`;

  const drawer = (
    <>
      <div
        className="pp-drawer-overlay"
        onClick={onClose}
        role="presentation"
        data-testid="trade-drawer-overlay"
      />
      <aside
        className="pp-trade-drawer"
        role="dialog"
        aria-label={`Trade ${asset.toUpperCase()} ${timeRange(market.startTime, market.endTime)}`}
        data-testid="trade-drawer"
      >
        <div className="pp-trade-drawer__header">
          <div>
            <div className="pp-trade-drawer__title">
              {asset.toUpperCase()} · {timeRange(market.startTime, market.endTime)}
            </div>
            <div className="pp-trade-drawer__subtitle">
              {market.strikePrice
                ? `Opens at ${formatStrikeUsd(market.strikePrice)}`
                : "Strike pending"}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="pp-trade-drawer__close"
            onClick={onClose}
            aria-label="Close trade drawer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="pp-trade-drawer__side-picker">
          <button
            type="button"
            className={`pp-btn pp-btn--lg ${side === "up" ? "pp-btn--up" : "pp-btn--secondary"}`}
            onClick={() => setSide("up")}
            aria-pressed={side === "up"}
          >
            <ArrowUp size={14} />
            <span>UP</span>
            <span className="pp-market-row__buy-btn-price">{upCents}¢</span>
          </button>
          <button
            type="button"
            className={`pp-btn pp-btn--lg ${side === "down" ? "pp-btn--down" : "pp-btn--secondary"}`}
            onClick={() => setSide("down")}
            aria-pressed={side === "down"}
          >
            <ArrowDown size={14} />
            <span>DOWN</span>
            <span className="pp-market-row__buy-btn-price">{downCents}¢</span>
          </button>
        </div>

        <input
          ref={stakeInputRef}
          type="text"
          inputMode="decimal"
          placeholder="$0.00"
          value={stakeInput}
          onChange={(e) => setStakeInput(e.target.value.replace(/[^\d.]/g, ""))}
          className={`pp-trade-drawer__stake-input ${stakeError ? "pp-trade-drawer__stake-input--error" : ""}`}
          aria-label="Stake amount in USD"
        />
        {stakeError && <div className="pp-trade-drawer__stake-error">{stakeError}</div>}

        <div className="pp-trade-drawer__quick-picks">
          {QUICK_PICKS.map((q) => (
            <button
              key={q.label}
              type="button"
              className="pp-btn pp-btn--secondary pp-btn--sm"
              onClick={() => handleQuickPick(q.value)}
            >
              {q.label}
            </button>
          ))}
        </div>

        <div className="pp-trade-drawer__summary">
          <div className="pp-trade-drawer__summary-row">
            <span className="label">You spend</span>
            <span className="value">{summary.youSpend}</span>
          </div>
          <div className="pp-trade-drawer__summary-row">
            <span className="label">Shares acquired</span>
            <span className="value">{summary.sharesAcquired}</span>
          </div>
          <div className="pp-trade-drawer__summary-row">
            <span className="label">Fees</span>
            <span className="value">{summary.fees}</span>
          </div>
          <div className="pp-trade-drawer__summary-divider" />
          <div className="pp-trade-drawer__summary-row">
            <span className="label">Payout if win</span>
            <span className="value">{summary.payoutIfWin}</span>
          </div>
          <div className="pp-trade-drawer__summary-row">
            <span className="label">To win</span>
            <span className="value">{summary.toWin}</span>
          </div>
        </div>

        <button
          type="button"
          className={submitClass}
          style={{ width: "100%" }}
          disabled={!stakeValid}
          onClick={handleSubmit}
        >
          {submitLabel}
        </button>

        <div className="pp-trade-drawer__footer-caption">
          Resolves at {resolveTimeUtc(market.endTime)} UTC against Chainlink {asset.toUpperCase()}/USD.
          Gasless — signed off-chain.
        </div>
      </aside>
    </>
  );

  if (!mounted) return null;
  return createPortal(drawer, document.body);
}

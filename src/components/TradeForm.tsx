"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useAccount, useSignTypedData } from "wagmi";
import { toast } from "sonner";
import {
  getConfig,
  getMarket,
  getDmmStatus,
  getPositions,
  postOrder,
  ORDER_TYPE_U8,
  type OrderApiType,
} from "@/lib/api";
import { buildOrderTypedData } from "@/lib/eip712";
import { validateLimitPriceCents } from "@/lib/derivations";
import { parseUsdtToAtomic } from "@/lib/format";
import {
  estimateTotalFee,
  formatShareCentsLabel,
  impliedProbabilityForSide,
  sharePriceBpsFromOrderBookMid,
} from "@/lib/feeEstimate";
import { approxProfitIfSideWinsUsd } from "@/lib/payoutEstimate";
import { parseCompositeMarketKey } from "@/lib/marketKey";
import { cn } from "@/lib/cn";
import { formatUserFacingError } from "@/lib/errors";
import { EmptyState } from "@/components/EmptyState";
import { WalletConnectorList } from "@/components/WalletConnectorList";
import { apiConfigAtom, sessionReadyAtom, userSmartAccount } from "@/store/atoms";

const PRESETS = [5, 25, 50, 100, 500];

// Ordered so the compact pill's short-click (Market ↔ Limit) matches index 0 / 1;
// long-press reveals the full list including POST_ONLY + IOC.
const ORDER_TYPES: { id: OrderApiType; label: string; hint?: string }[] = [
  { id: "MARKET", label: "Market", hint: "fill now" },
  { id: "LIMIT", label: "Limit", hint: "rest on book" },
  { id: "POST_ONLY", label: "Post-only", hint: "maker only" },
  { id: "IOC", label: "IOC", hint: "fill or cancel" },
];

const LONG_PRESS_MS = 400;

function InfoTip({ text }: { text: string }) {
  return (
    <span className="inline-flex align-middle" title={text}>
      <span className="sr-only">{text}</span>
      <svg
        className="ml-0.5 inline h-3 w-3"
        viewBox="0 0 12 12"
        fill="currentColor"
        aria-hidden
        style={{ color: "var(--fg-2)" }}
      >
        <path d="M6 0a6 6 0 100 12A6 6 0 006 0zm.75 9H5.25V5.25h1.5V9zm0-5.25H5.25v-1h1.5v1z" />
      </svg>
    </span>
  );
}

function TradeFormInner({ marketAddress }: { marketAddress: string }) {
  const searchParams = useSearchParams();
  const { address, isConnected } = useAccount();
  const smartAccount = useAtomValue(userSmartAccount);
  const sessionReady = useAtomValue(sessionReadyAtom);
  const apiConfig = useAtomValue(apiConfigAtom);
  const [side, setSide] = useState<1 | 2>(1);
  const [dollars, setDollars] = useState(25);
  const [orderSide, setOrderSide] = useState<0 | 1>(0);
  const [orderType, setOrderType] = useState<OrderApiType>("MARKET");
  const [userPriceCentsInput, setUserPriceCentsInput] = useState<string>("");
  const [otypeMenuOpen, setOtypeMenuOpen] = useState(false);
  const otypeRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  // Short-click toggles Market ↔ Limit; long-press (>LONG_PRESS_MS) opens a
  // popover with all four order types. Pointer events rather than mousedown
  // so touch + mouse both route through the same handlers.
  const handleOtypePressStart = useCallback(() => {
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setOtypeMenuOpen(true);
    }, LONG_PRESS_MS);
  }, []);
  const handleOtypePressEnd = useCallback(() => {
    if (longPressTimer.current != null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (longPressFired.current) return;
    setOrderType((t) => (t === "MARKET" ? "LIMIT" : "MARKET"));
  }, []);
  const handleOtypeCancel = useCallback(() => {
    if (longPressTimer.current != null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // Dismiss the menu on outside click.
  useEffect(() => {
    if (!otypeMenuOpen) return;
    function onDoc(e: MouseEvent) {
      if (otypeRef.current && !otypeRef.current.contains(e.target as Node)) {
        setOtypeMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [otypeMenuOpen]);
  const qc = useQueryClient();
  const connectSectionRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const sideParam = searchParams.get("side");
    if (sideParam === "1") setSide(1);
    else if (sideParam === "2") setSide(2);

    const amountParam = searchParams.get("amount");
    if (amountParam) {
      const n = parseInt(amountParam, 10);
      if (n >= 5 && n <= 500) setDollars(n);
    }
  }, [searchParams]);

  function scrollToConnect() {
    connectSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  const parsedKey = useMemo(() => parseCompositeMarketKey(marketAddress), [marketAddress]);

  const { data: cfg } = useQuery({
    queryKey: ["apiConfig"],
    queryFn: getConfig,
    staleTime: 300_000,
  });

  const marketKey = parsedKey?.composite ?? marketAddress;

  const { data: market } = useQuery({
    queryKey: ["market", marketKey.toLowerCase()],
    queryFn: () => getMarket(marketKey),
    enabled: !!parsedKey,
    refetchInterval: 15_000,
  });

  const { data: dmmStatus } = useQuery({
    queryKey: ["dmmStatus", address?.toLowerCase() ?? ""],
    queryFn: () => getDmmStatus(address!),
    enabled: !!address && isConnected,
    staleTime: 60_000,
  });

  const { signTypedDataAsync } = useSignTypedData();

  const totalBps = (cfg?.platformFeeBps ?? 70) + (cfg?.makerFeeBps ?? 80);

  const autoLimitPrice = useMemo(() => {
    if (!market || orderType === "MARKET") return 5000;
    const ob = side === 1 ? market.orderBook.up : market.orderBook.down;
    const ask = ob.bestAsk?.price;
    const bid = ob.bestBid?.price;
    if (side === 1) {
      if (ask) return Math.min(9999, ask + 50);
      if (bid) return Math.min(9999, bid + 100);
    } else {
      if (bid) return Math.max(1, bid - 50);
      if (ask) return Math.max(1, ask - 100);
    }
    return 5000;
  }, [market, orderType, side]);

  useEffect(() => {
    setUserPriceCentsInput("");
  }, [orderType, side, marketKey]);

  const userPriceParsed = validateLimitPriceCents(userPriceCentsInput);
  const userOverrideActive = userPriceCentsInput !== "" && userPriceParsed.value != null;
  const limitPrice = userOverrideActive ? (userPriceParsed.value as number) * 100 : autoLimitPrice;
  const autoCentsDisplay = Math.round(autoLimitPrice / 100);
  const priceInputInvalid = userPriceCentsInput !== "" && userPriceParsed.value == null;

  const impliedP =
    market != null ? impliedProbabilityForSide(side, market.upPrice, market.downPrice) : 0.5;

  const sharePriceBps = useMemo(() => {
    if (!market) return 5000;
    return sharePriceBpsFromOrderBookMid(side, market.orderBook);
  }, [market, side]);

  const { feeUsd: feeUsdDisplay, effectivePercentOfNotional } = estimateTotalFee(
    Number(dollars),
    totalBps,
    sharePriceBps,
    cfg?.feeModel,
  );
  const shareCentsLabel = formatShareCentsLabel(sharePriceBps);
  const peakFeeBps = cfg?.peakFeeBps ?? totalBps;
  const peakFeePct = (peakFeeBps / 100).toFixed(2);

  const payoutIfWin = approxProfitIfSideWinsUsd(Number(dollars), impliedP, totalBps, {
    feeModel: cfg?.feeModel,
    sharePriceBps,
  });

  // Best-book price for each side — shown inside the UP/DOWN tabs so trader
  // has a single line of truth without glancing at the book ladder.
  const upCents = useMemo(() => {
    if (!market) return null;
    const p = market.orderBook.up.bestAsk?.price ?? market.orderBook.up.bestBid?.price;
    return p != null ? Math.round(p / 100) : null;
  }, [market]);
  const downCents = useMemo(() => {
    if (!market) return null;
    const p = market.orderBook.down.bestAsk?.price ?? market.orderBook.down.bestBid?.price;
    return p != null ? Math.round(p / 100) : null;
  }, [market]);

  const submit = useMutation({
    mutationFn: async () => {
      if (!address || !cfg || !parsedKey) throw new Error("Connect wallet");
      if (!market || market.status !== "ACTIVE") throw new Error("Market not active");
      const amount = parseUsdtToAtomic(String(dollars));
      const min = parseUsdtToAtomic("5");
      const max = parseUsdtToAtomic("500");
      if (amount < min || amount > max) throw new Error("Amount must be $5–$500");

      if (orderType !== "MARKET" && userPriceCentsInput !== "") {
        const v = validateLimitPriceCents(userPriceCentsInput);
        if (v.value == null) throw new Error(v.error ?? "Invalid price");
      }

      if (orderSide === 1 /* SELL */) {
        try {
          const positions = await getPositions(address);
          const match = positions.find(
            (p) => p.market.toLowerCase() === parsedKey.composite.toLowerCase() && p.option === side,
          );
          const owned = match ? BigInt(match.shares) : BigInt(0);
          if (owned < amount) {
            throw new Error(
              match
                ? `Insufficient shares to sell. You own $${(Number(owned) / 1e6).toFixed(2)} of ${side === 1 ? "UP" : "DOWN"}.`
                : `Insufficient shares to sell. You don't own any ${side === 1 ? "UP" : "DOWN"} shares on this market.`,
            );
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("Insufficient shares")) throw e;
          console.warn("[TradeForm] positions precheck failed, proceeding to sign:", e);
        }
      }

      const nonce = Math.floor(Math.random() * 1e12);
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const typeNum = ORDER_TYPE_U8[orderType];
      const priceNum = orderType === "MARKET" ? 0 : limitPrice;

      const msg = {
        maker: address as `0x${string}`,
        market: parsedKey.marketId,
        option: BigInt(side),
        side: orderSide,
        type: typeNum,
        price: BigInt(priceNum),
        amount,
        nonce: BigInt(nonce),
        expiry: BigInt(expiry),
      };

      const typed = buildOrderTypedData(cfg, msg);
      const signature = await signTypedDataAsync(typed);

      await postOrder({
        maker: address,
        market: parsedKey.composite,
        option: side,
        side: orderSide,
        type: typeNum,
        price: orderType === "MARKET" ? 0 : priceNum,
        amount: amount.toString(),
        nonce,
        expiry,
        signature,
      });
    },
    onSuccess: () => {
      toast.success("Order submitted");
      const sa = smartAccount?.toLowerCase() ?? "";
      const addrLower = address?.toLowerCase() ?? "";
      qc.invalidateQueries({ queryKey: ["positions", sa] });
      qc.invalidateQueries({ queryKey: ["balance", addrLower] });
      qc.invalidateQueries({ queryKey: ["orderbook", marketKey.toLowerCase()] });
      qc.invalidateQueries({ queryKey: ["orders", addrLower] });
    },
    onError: (e: Error) => toast.error(formatUserFacingError(e)),
  });

  if (!parsedKey) {
    return (
      <EmptyState
        icon="chart"
        title="Invalid market link"
        subtitle="This URL does not match a valid market key (settlement address and market id)."
      />
    );
  }

  const rebateBps = dmmStatus?.isDmm ? apiConfig?.dmmRebateBps : undefined;

  const activeOtype = ORDER_TYPES.find((t) => t.id === orderType) ?? ORDER_TYPES[0]!;

  return (
    <div className="pp-panel pp-trade">
      {/* Order-type row: compact pill (short click toggles Market ↔ Limit,
          long-press opens full menu). Sits above the Buy/Sell control. */}
      <div className="flex items-center justify-between">
        <span className="pp-micro">Trade</span>
        <div ref={otypeRef} className="relative">
          <button
            type="button"
            className="pp-otype"
            onPointerDown={handleOtypePressStart}
            onPointerUp={handleOtypePressEnd}
            onPointerLeave={handleOtypeCancel}
            onPointerCancel={handleOtypeCancel}
            onContextMenu={(e) => {
              e.preventDefault();
              setOtypeMenuOpen(true);
            }}
            title="Click: toggle Market / Limit — hold: more types"
          >
            {activeOtype.label}
            <span className="pp-otype__caret">▾</span>
          </button>
          {otypeMenuOpen && (
            <div className="pp-otype-menu" style={{ right: 0, top: "calc(100% + 4px)" }}>
              {ORDER_TYPES.map((ot) => (
                <button
                  key={ot.id}
                  type="button"
                  className={cn(
                    "pp-otype-menu__item",
                    orderType === ot.id && "pp-otype-menu__item--on",
                  )}
                  onClick={() => {
                    setOrderType(ot.id);
                    setOtypeMenuOpen(false);
                  }}
                >
                  <span>{ot.label}</span>
                  {ot.hint && <span className="pp-otype-menu__item-hint">{ot.hint}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Buy / Sell segmented */}
      <div className="pp-seg">
        <button
          type="button"
          className={cn("pp-seg__btn", orderSide === 0 && "pp-seg__btn--on")}
          onClick={() => setOrderSide(0)}
        >
          Buy
        </button>
        <button
          type="button"
          className={cn("pp-seg__btn", orderSide === 1 && "pp-seg__btn--on")}
          onClick={() => setOrderSide(1)}
        >
          Sell
        </button>
      </div>

      {/* UP / DOWN — nested price span uses font-variant-numeric inline rather
          than .pp-tabular so color inherits from the parent button (bg-0 on
          active green/red, fg-1 on inactive) instead of forcing fg-1 which
          would wash out against the solid accent when the side is selected. */}
      <div className="pp-trade__ud">
        <button
          type="button"
          className={cn("pp-trade__udbtn", side === 1 && "pp-trade__udbtn--up-on")}
          onClick={() => {
            setSide(1);
            if (!isConnected) scrollToConnect();
          }}
        >
          <span>▲ UP</span>
          <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
            {upCents != null ? `${upCents}¢` : "—"}
          </span>
        </button>
        <button
          type="button"
          className={cn("pp-trade__udbtn", side === 2 && "pp-trade__udbtn--down-on")}
          onClick={() => {
            setSide(2);
            if (!isConnected) scrollToConnect();
          }}
        >
          <span>▼ DOWN</span>
          <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
            {downCents != null ? `${downCents}¢` : "—"}
          </span>
        </button>
      </div>

      {/* Limit price — only visible when the order type rests on the book.
          Pre-fills with the auto-derived cents (best-ask + 50 bps / best-bid
          − 50 bps) so the user sees a sensible number they can edit in place,
          rather than a greyed-out placeholder. */}
      {orderType !== "MARKET" && (
        <div className="mt-3">
          <label className="pp-micro" htmlFor="limit-price-cents">
            Limit price · cents
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="limit-price-cents"
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              step={1}
              value={userPriceCentsInput === "" ? autoCentsDisplay : userPriceCentsInput}
              onChange={(e) => setUserPriceCentsInput(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              className={cn(
                "pp-input pp-input--mono w-24 text-center",
                priceInputInvalid && "pp-input--invalid",
              )}
              aria-invalid={priceInputInvalid}
              aria-describedby="limit-price-hint"
            />
            <span className="pp-caption">= {limitPrice} bps</span>
          </div>
          {priceInputInvalid && (
            <p id="limit-price-hint" className="pp-caption mt-1 pp-down">
              {userPriceParsed.error}
            </p>
          )}
        </div>
      )}

      {/* Size — editable input with preset quick-sets. Range slider removed
          so the input reads as the primary control; presets populate it. */}
      <div className="mt-3">
        <label className="pp-micro" htmlFor="trade-size-usdt">
          Size · USDT
        </label>
        <div className="mt-1 flex items-center gap-2">
          <span className="pp-micro" style={{ color: "var(--fg-2)" }}>$</span>
          <input
            id="trade-size-usdt"
            type="number"
            inputMode="decimal"
            min={5}
            max={500}
            step={1}
            value={dollars}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setDollars(n);
            }}
            onFocus={(e) => e.currentTarget.select()}
            className={cn(
              "pp-input pp-input--mono flex-1 text-right",
              (dollars < 5 || dollars > 500) && "pp-input--invalid",
            )}
            aria-invalid={dollars < 5 || dollars > 500}
          />
        </div>
        <div className="pp-trade__presets mt-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={cn(
                "pp-trade__preset",
                dollars === p && "pp-trade__preset--on",
              )}
              onClick={() => setDollars(p)}
            >
              ${p}
            </button>
          ))}
        </div>
        {(dollars < 5 || dollars > 500) && (
          <p className="pp-caption mt-1 pp-down">Amount must be $5–$500.</p>
        )}
      </div>

      {/* Summary */}
      <div className="pp-trade__summary">
        <div>
          If {side === 1 ? "UP" : "DOWN"} wins:{" "}
          <span className={side === 1 ? "pp-up" : "pp-down"}>+${payoutIfWin.toFixed(2)}</span>{" "}
          <span className="pp-caption">(est., after fees)</span>
        </div>
        <div className="pp-caption">
          Fee: <span className="pp-tabular" style={{ color: "var(--fg-0)" }}>
            ${feeUsdDisplay.toFixed(2)} ({effectivePercentOfNotional.toFixed(2)}% at {shareCentsLabel})
          </span>
          <InfoTip
            text={`Peak ${peakFeePct}% at 50¢. Probability-weighted, tapers at extremes.`}
          />
        </div>
        {rebateBps != null && rebateBps > 0 && (
          <div className="pp-caption pp-up" style={{ fontWeight: 500 }}>
            Earns {(rebateBps / 100).toFixed(2)}% rebate on this fill
          </div>
        )}
      </div>

      {/* Submit / connect */}
      {isConnected ? (
        <button
          type="button"
          disabled={
            submit.isPending ||
            market?.status !== "ACTIVE" ||
            !sessionReady ||
            priceInputInvalid
          }
          title={
            !sessionReady
              ? "Complete connection first"
              : priceInputInvalid
                ? (userPriceParsed.error ?? "Fix price before submitting")
                : undefined
          }
          className={cn(
            "pp-btn pp-btn--lg pp-trade__cta",
            side === 1 ? "pp-btn--up" : "pp-btn--down",
          )}
          onClick={() => submit.mutate()}
        >
          {submit.isPending
            ? "Signing…"
            : `${orderSide === 0 ? "Buy" : "Sell"} ${side === 1 ? "UP" : "DOWN"} · ${orderType === "MARKET" ? "MKT" : `${Math.round(limitPrice / 100)}¢`}`}
        </button>
      ) : (
        <div
          ref={connectSectionRef}
          className="mt-3 rounded-[6px] border p-3"
          style={{ background: "var(--bg-0)", borderColor: "var(--border-0)" }}
        >
          <p className="pp-body-strong text-center">Connect wallet to trade</p>
          <p className="pp-caption mt-1 text-center">
            Choose a wallet to sign in. Adjust side and size first.
          </p>
          <WalletConnectorList className="mt-3" />
        </div>
      )}
    </div>
  );
}

export function TradeForm({ marketAddress }: { marketAddress: string }) {
  return (
    <Suspense
      fallback={<div className="pp-panel pp-caption text-center">Loading…</div>}
    >
      <TradeFormInner marketAddress={marketAddress} />
    </Suspense>
  );
}

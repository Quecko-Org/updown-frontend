"use client";

import { Info } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useAccount, useSignTypedData, useWriteContract, useWalletClient } from "wagmi";
import { erc20Abi, maxUint256 } from "viem";
import { createPublicClient, http } from "viem";
import { arbitrum } from "viem/chains";
import { ALCHEMY_RPC_URL } from "@/config/environment";
import { toast } from "sonner";
import {
  getConfig,
  getMarket,
  getDmmStatus,
  getOrderbook,
  getPositions,
  postOrder,
  ORDER_TYPE_U8,
  type OrderApiType,
  type OrderBookResponse,
} from "@/lib/api";
import { buildOrderTypedData } from "@/lib/eip712";
import { deriveEffectiveStatus, validateLimitPriceCents } from "@/lib/derivations";
import { parseUsdtToAtomic } from "@/lib/format";
import {
  bestEffectivePriceCents,
  estimateTotalFee,
  formatShareCentsLabel,
  sharePriceBpsFromOrderBookMid,
} from "@/lib/feeEstimate";
import {
  slippageDecision,
  usdToShares,
  walkBookForAvgFillPrice,
} from "@/lib/orderBookFill";
import {
  MAX_STAKE_USDT,
  MIN_STAKE_USDT,
  maxStakeForBalance,
} from "@/lib/stakeBounds";
import { parseCompositeMarketKey } from "@/lib/marketKey";
import { cn } from "@/lib/cn";
import { formatUserFacingError, isUserRejection } from "@/lib/errors";
import { track } from "@/lib/analytics";
import { isTerminalMarketStatus } from "@/lib/derivations";
import { EmptyState } from "@/components/EmptyState";
import { WalletConnectorList } from "@/components/WalletConnectorList";
import { MarketClosedPanel } from "@/components/MarketClosedPanel";
import { TermsAcceptanceModal } from "@/components/TermsAcceptanceModal";
import { hasAcceptedCurrentVersion } from "@/lib/termsAcceptance";
import { apiConfigAtom, geoStateAtom, userSmartAccount } from "@/store/atoms";

// PR-18: USD-stake-based UI presets. Polymarket-parity. The +$X buttons
// add to whatever value is currently in the stake input; "Max" fills with
// `min(availableBalance, MAX_STAKE_USDT)` per the lib/stakeBounds clamp.
type StakeQuickAdd = { kind: "add"; usd: number } | { kind: "max" };
const STAKE_QUICK_ADDS: StakeQuickAdd[] = [
  { kind: "add", usd: 5 },
  { kind: "add", usd: 25 },
  { kind: "add", usd: 100 },
  { kind: "max" },
];

const EXPIRY_MODES: { id: "never" | "1h" | "close"; label: string; hint: string }[] = [
  { id: "close", label: "Until close", hint: "expires when market resolves" },
  { id: "1h", label: "1 hour", hint: "expires in 60 min" },
  { id: "never", label: "Never", hint: "never expires" },
];

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
    <span className="ml-1 inline-flex align-middle" title={text} style={{ color: "var(--fg-2)" }}>
      <span className="sr-only">{text}</span>
      <Info size={12} strokeWidth={1.5} aria-hidden />
    </span>
  );
}

function TradeFormInner({ marketAddress }: { marketAddress: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { address, isConnected } = useAccount();
  const smartAccount = useAtomValue(userSmartAccount);
  const apiConfig = useAtomValue(apiConfigAtom);
  const geo = useAtomValue(geoStateAtom);
  const geoBlocked = geo.status === "restricted";
  const [side, setSide] = useState<1 | 2>(1);
  // PR-18 P1-19: USD-stake-based primary input. Polymarket-parity. The
  // string-typed state lets the user type partial / decimal values
  // ("5", "5.50", "") without forcing a number coercion on every
  // keystroke. We parse to a number (then atomic) at use-sites.
  const [stakeUsdInput, setStakeUsdInput] = useState<string>("");
  const [orderSide, setOrderSide] = useState<0 | 1>(0);
  const [orderType, setOrderType] = useState<OrderApiType>("MARKET");
  const [userPriceCentsInput, setUserPriceCentsInput] = useState<string>("");
  // Phase2-C: explicit expiry control. Default "close" so a resting LIMIT
  // doesn't outlive the market window (matches the matching engine's
  // MARKET_ENDED behavior — choosing it explicitly avoids the "where did my
  // order go?" surprise from previous Until-MARKET_ENDED implicit cancels).
  const [expiryMode, setExpiryMode] = useState<"never" | "1h" | "close">(
    "close",
  );
  const [otypeMenuOpen, setOtypeMenuOpen] = useState(false);
  const otypeRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  // WS2 PR B: terms acceptance gate. Modal only opens on the first trade
  // attempt for an unaccepted wallet — connecting alone does not trigger
  // it, so users can browse / inspect markets without a forced legal
  // interstitial.
  const [termsModalOpen, setTermsModalOpen] = useState(false);

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

    // PR-18 P1-19: deep-link `?stake=N` (USD dollars, 1..500).
    const stakeParam = searchParams.get("stake");
    if (stakeParam) {
      const n = parseFloat(stakeParam);
      if (Number.isFinite(n) && n >= 1 && n <= MAX_STAKE_USDT) {
        setStakeUsdInput(n.toFixed(2));
      }
    }

    // Legacy redirect: `?shares=N` (Phase2-C share-denominated input)
    // convert to USD stake assuming a 50¢ default (shares × $0.50 = stake).
    // `?amount=N` (pre-Phase2-C, USD) is the same shape as the new
    // `?stake` so we just rename the param. Both legacy params are
    // dropped from the URL on rewrite — bookmarks land on the new format.
    const sharesParam = searchParams.get("shares");
    const amountParam = searchParams.get("amount");
    if (!stakeParam && (sharesParam || amountParam)) {
      let stakeUsdRedirect: number | null = null;
      if (sharesParam) {
        const s = parseInt(sharesParam, 10);
        if (Number.isFinite(s) && s >= 1 && s <= 1000) {
          stakeUsdRedirect = Math.min(MAX_STAKE_USDT, Math.max(MIN_STAKE_USDT, s * 0.5));
        }
      } else if (amountParam) {
        const a = parseFloat(amountParam);
        if (Number.isFinite(a) && a >= 1 && a <= MAX_STAKE_USDT) {
          stakeUsdRedirect = a;
        }
      }
      if (stakeUsdRedirect != null) {
        setStakeUsdInput(stakeUsdRedirect.toFixed(2));
        const next = new URLSearchParams(searchParams.toString());
        next.delete("amount");
        next.delete("shares");
        next.set("stake", stakeUsdRedirect.toFixed(2));
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // PR-18 P0-19: full-depth orderbook for VWAP-based MARKET-order pricing.
  // The trimmed `market.orderBook` shape only carries top-of-book; for
  // walkBookForAvgFillPrice we need every rung. React Query dedupes this
  // with OrderBook.tsx's identical query (same key) — free.
  // 2s refetch is fine for dev; P3 follow-up is to drop polling and use
  // the WS `orderbook_update` channel exclusively. Logged in PR-18 design.
  const { data: fullOrderbook } = useQuery<OrderBookResponse>({
    queryKey: ["orderbook", marketKey.toLowerCase()],
    queryFn: () => getOrderbook(marketKey),
    enabled: !!parsedKey,
    refetchInterval: 2_000,
    staleTime: 1_000,
  });

  // F2: countdown-aware gate. The 15s `market` refetch interval is too slow
  // to catch the moment a market hits 0:00 — the backend status flip lags
  // a few seconds behind real time. Without a local countdown, a user can
  // submit at "0:01" and the order POST lands when the matching engine has
  // already cancelled all resting orders for that market (TRADING_ENDED).
  // Compute the remaining seconds locally + use deriveEffectiveStatus so
  // the submit button disables the moment countdown crosses 0:00, even if
  // the backend's `market.status` hasn't refreshed yet.
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() =>
    market?.endTime ? Math.max(0, market.endTime - Math.floor(Date.now() / 1000)) : 0,
  );
  useEffect(() => {
    if (!market?.endTime) return;
    const tick = () =>
      setSecondsRemaining(Math.max(0, market.endTime - Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [market?.endTime]);

  const countdownLabel = secondsRemaining > 0
    ? `${Math.floor(secondsRemaining / 60)}:${(secondsRemaining % 60).toString().padStart(2, "0")}`
    : "0:00";
  const effectiveMarketStatus = market
    ? deriveEffectiveStatus(market.status, countdownLabel)
    : "";
  const isMarketTradeable = effectiveMarketStatus === "ACTIVE";

  const { data: dmmStatus } = useQuery({
    queryKey: ["dmmStatus", address?.toLowerCase() ?? ""],
    queryFn: () => getDmmStatus(address!),
    enabled: !!address && isConnected,
    staleTime: 60_000,
  });

  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const { data: wc } = useWalletClient();

  /**
   * One-time-per-wallet `USDT.approve(settlement, MaxUint256)` from the EOA.
   *
   * Path-1 architecture: USDT lives on the EOA; the settlement contract pulls
   * via `transferFrom(eoa, settlement, fillAmount)` inside `enterPosition`.
   * Without this allowance the first BUY would revert. Idempotent: reads
   * current allowance and only triggers the wallet popup when below threshold.
   *
   * Cost: ~50k gas, paid in ETH on Arbitrum (a few cents at typical prices).
   * Once approved, every future trade is gasless from the user's POV — only
   * a typed-data signature.
   */
  const ensureSettlementAllowance = useCallback(async () => {
    if (!address || !cfg || !wc) return;
    const settlement = cfg.eip712.domain.verifyingContract as `0x${string}`;
    const usdt = cfg.usdtAddress as `0x${string}`;
    const pub = createPublicClient({ chain: arbitrum, transport: http(ALCHEMY_RPC_URL) });
    const THRESHOLD = BigInt(10_000) * BigInt(10) ** BigInt(6);
    const current = (await pub.readContract({
      address: usdt,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address as `0x${string}`, settlement],
    })) as bigint;
    if (current >= THRESHOLD) return;
    track("approve_attempted");
    toast.info("One-time approval needed — confirm in your wallet (small ETH gas).");
    // Auto-retry-once on transient RPC layer failures ("JSON is not a valid
    // request object" etc). User-rejections are NOT retried — if they declined,
    // we honor that. The retry is silent so the wallet popup re-opens once on
    // RPC hiccups without surfacing scary tech errors.
    let hash: `0x${string}`;
    try {
      hash = await writeContractAsync({
        address: usdt,
        abi: erc20Abi,
        functionName: "approve",
        args: [settlement, maxUint256],
      });
    } catch (e) {
      if (isUserRejection(e)) throw e;
      hash = await writeContractAsync({
        address: usdt,
        abi: erc20Abi,
        functionName: "approve",
        args: [settlement, maxUint256],
      });
    }
    await pub.waitForTransactionReceipt({ hash });
    track("approve_succeeded", { txHash: hash });
  }, [address, cfg, wc, writeContractAsync]);

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

  // Phase2-C: per-side mid prices for the BIG selector buttons. Both sides
  // are computed regardless of which is selected so the user sees the live
  // probability of the other side too. Polymarket parity.
  const upMidCents = useMemo(
    () => (market ? sharePriceBpsFromOrderBookMid(1, market.orderBook) / 100 : 50),
    [market],
  );
  const downMidCents = useMemo(
    () => (market ? sharePriceBpsFromOrderBookMid(2, market.orderBook) / 100 : 50),
    [market],
  );

  // PR-18 P0-19: stake-aware VWAP for MARKET orders. Walks the relevant
  // side of the FULL orderbook (asks for BUY, bids for SELL) accumulating
  // depth until the user's stake is satisfied — returns the volume-
  // weighted-average fill price they'll actually pay/receive. NEVER falls
  // back to midpoint or top-of-book when stake walks multiple levels —
  // that's the bug we're closing.
  const stakeAtomicForVwap = useMemo(() => {
    const usd = parseFloat(parseFloat(stakeUsdInput).toFixed(2));
    if (!Number.isFinite(usd) || usd <= 0) return BigInt(0);
    return parseUsdtToAtomic(usd.toFixed(2));
  }, [stakeUsdInput]);

  const vwapResult = useMemo(() => {
    if (orderType !== "MARKET") return null;
    if (!fullOrderbook) return null;
    if (stakeAtomicForVwap <= BigInt(0)) return null;
    const sideBook = side === 1 ? fullOrderbook.up : fullOrderbook.down;
    // BUY (orderSide=0) hits asks (ascending). SELL (orderSide=1) hits
    // bids (descending). Backend already sorts in those orders.
    const levels = orderSide === 0 ? sideBook.asks : sideBook.bids;
    return walkBookForAvgFillPrice(levels, stakeAtomicForVwap);
  }, [orderType, fullOrderbook, stakeAtomicForVwap, side, orderSide]);

  // Effective per-share price (cents) used for Total / To-win / fee calc
  // AND the action-button label.
  //   - LIMIT/POST_ONLY/IOC: user's typed limit price.
  //   - MARKET with computable VWAP: that VWAP.
  //   - MARKET without VWAP yet (no stake / book still loading): top-of-
  //     book best-ask/best-bid via the legacy helper. Used only to render
  //     a placeholder; submit is gated by depth flags below.
  const effectivePriceCents = useMemo(() => {
    if (orderType !== "MARKET") {
      return limitPrice / 100;
    }
    if (vwapResult?.avgPriceBps != null) {
      return Number(vwapResult.avgPriceBps) / 100;
    }
    if (!market) return 50;
    return bestEffectivePriceCents(side, orderSide, market.orderBook);
  }, [orderType, limitPrice, vwapResult, market, side, orderSide]);

  // Depth-availability flags for the disabled-button gate.
  const noLiquidity =
    orderType === "MARKET" &&
    stakeAtomicForVwap > BigInt(0) &&
    vwapResult != null &&
    vwapResult.avgPriceBps == null;
  const insufficientDepth =
    orderType === "MARKET" &&
    stakeAtomicForVwap > BigInt(0) &&
    vwapResult != null &&
    vwapResult.requiresMoreDepth &&
    vwapResult.avgPriceBps != null;
  const insufficientDepthMaxUsd = useMemo(() => {
    if (!insufficientDepth || !vwapResult) return 0;
    return Number(vwapResult.fillableAtomic) / 1_000_000;
  }, [insufficientDepth, vwapResult]);

  // PR-18 P1-19: stake comes directly from the user's USD input. Parse
  // tolerantly — empty string / non-numeric / negative all collapse to 0
  // (which trips the disabled-button gate's `stakeUsd <= 0` check).
  const stakeUsd = useMemo(() => {
    const n = parseFloat(stakeUsdInput);
    if (!Number.isFinite(n) || n <= 0) return 0;
    // Round to cents to match the wire's 2dp atomic-USDT precision.
    return Math.round(n * 100) / 100;
  }, [stakeUsdInput]);

  // Shares-acquired preview (display only). Computed via the integer
  // BigInt helper to match the wire's rounding rule exactly: floor
  // division so actualCost ≤ stakeUsd always holds. The display number
  // is what the user will see in their position post-fill, so it must
  // never overstate.
  const sharesPreview = useMemo(() => {
    if (stakeUsd <= 0 || effectivePriceCents <= 0) return 0;
    const stakeAtomic = parseUsdtToAtomic(stakeUsd.toFixed(2));
    const priceBps = BigInt(Math.max(1, Math.min(9999, Math.round(effectivePriceCents * 100))));
    const sharesAtomic = usdToShares(stakeAtomic, priceBps);
    // Atomic USDT scale (6 decimals) → display dollars. "Shares acquired"
    // and "to win" are equivalent dollar amounts in our model (1 share =
    // $1 if winning); see PR-18 design §5 wire-shape note.
    return Number(sharesAtomic) / 1_000_000;
  }, [stakeUsd, effectivePriceCents]);

  const stakeOutOfRange =
    stakeUsd > 0 && (stakeUsd < MIN_STAKE_USDT || stakeUsd > MAX_STAKE_USDT);

  // Phase2-C: the share price feeding fee math is the EFFECTIVE price the
  // trade fills at, not the order-book mid. For LIMIT/POST_ONLY/IOC at a
  // user-chosen cents that's exactly what they pay; for MARKET it's the
  // best-ask / best-bid fallback. Matches what the user sees in "Total".
  const sharePriceBps = useMemo(
    () => Math.max(1, Math.min(9999, Math.round(effectivePriceCents * 100))),
    [effectivePriceCents],
  );

  const { feeUsd: feeUsdDisplay, effectivePercentOfNotional } = estimateTotalFee(
    stakeUsd,
    totalBps,
    sharePriceBps,
    cfg?.feeModel,
  );
  const shareCentsLabel = formatShareCentsLabel(sharePriceBps);
  const peakFeeBps = cfg?.peakFeeBps ?? totalBps;
  const peakFeePct = (peakFeeBps / 100).toFixed(2);

  // Polymarket-parity: To-win = shares × $1 (each winning share pays $1).
  // For BUY: net profit ≈ toWin − stakeUsd − fee. For SELL: stakeUsd is the
  // proceeds the user receives; toWin doubles as the exposure if their side
  // wins (they'd owe shares × $1).
  const toWinUsd = sharesPreview;
  const profitIfBuyWin = Math.max(0, toWinUsd - stakeUsd - feeUsdDisplay);

  const submit = useMutation({
    mutationFn: async () => {
      if (!address || !cfg || !parsedKey) throw new Error("Connect wallet");
      // F2: belt-and-suspenders — even with the disabled-button gate above,
      // a click race could fire mutate() while the market is between ACTIVE
      // and TRADING_ENDED. Throw early so the user gets the friendly toast
      // (formatUserFacingError maps "Market not active" → user-facing copy)
      // instead of waiting for the backend to reject after signing.
      if (!market || !isMarketTradeable || market.status !== "ACTIVE") {
        throw new Error("Market not active");
      }
      // F2: console trace so future debugging of "didn't persist" issues
      // has a paper trail. One line per submit attempt; cheap.
      console.info("[TradeForm] submit", {
        market: parsedKey.composite,
        marketStatus: market.status,
        effectiveStatus: effectiveMarketStatus,
        secondsRemaining,
        side,
        orderSide,
        orderType,
        sharesPreview,
        effectivePriceCents,
        stakeUsd,
        stakeUsdInput,
        userPriceCentsInput: userPriceCentsInput || `(auto:${autoCentsDisplay}¢)`,
        expiryMode,
      });

      // Path-1: ensure the EOA has approved settlement for USDT before BUY.
      // Idempotent on subsequent trades. SELL doesn't need allowance (no
      // transferFrom; settlement only debits buyers).
      if (orderSide === 0 /* BUY */) {
        await ensureSettlementAllowance();
      }

      // Phase2-C: shares × price → stake. Backend payload remains stake-based;
      // the share-input is purely a UI abstraction.
      const amount = parseUsdtToAtomic(stakeUsd.toFixed(2));
      const min = parseUsdtToAtomic(String(MIN_STAKE_USDT));
      const max = parseUsdtToAtomic(String(MAX_STAKE_USDT));
      if (amount < min || amount > max) {
        throw new Error(`Amount must be $${MIN_STAKE_USDT}–$${MAX_STAKE_USDT}`);
      }

      if (orderType !== "MARKET" && userPriceCentsInput !== "") {
        const v = validateLimitPriceCents(userPriceCentsInput);
        if (v.value == null) throw new Error(v.error ?? "Invalid price");
      }

      // PR-18 P0-19: slippage recompute. Capture the price the user saw
      // when they clicked, then re-walk the freshest order-book snapshot
      // and decide adverse-vs-favorable. Only MARKET orders need this —
      // LIMIT/POST_ONLY/IOC sign at the user's typed price by definition.
      // 1¢ threshold per PR-18 decision log; adverse-only (favorable
      // moves never prompt — silent acceptance is the right default).
      if (orderType === "MARKET" && vwapResult?.avgPriceBps != null) {
        const displayedBps = vwapResult.avgPriceBps;
        // Force a fresh fetch — bypass React Query's 2s cache so the
        // submit-time snapshot is as fresh as possible.
        const fresh = await qc.fetchQuery({
          queryKey: ["orderbook", marketKey.toLowerCase()],
          queryFn: () => getOrderbook(marketKey),
          staleTime: 0,
        });
        const freshSideBook = side === 1 ? fresh.up : fresh.down;
        const freshLevels = orderSide === 0 ? freshSideBook.asks : freshSideBook.bids;
        const freshVwap = walkBookForAvgFillPrice(freshLevels, amount);
        if (freshVwap.avgPriceBps == null) {
          throw new Error("No matching liquidity at submit time. Try again or pick a different side.");
        }
        if (freshVwap.requiresMoreDepth) {
          throw new Error(
            `Insufficient liquidity at submit time. Max fillable now: $${(Number(freshVwap.fillableAtomic) / 1_000_000).toFixed(2)}.`,
          );
        }
        const decision = slippageDecision(
          displayedBps,
          freshVwap.avgPriceBps,
          orderSide,
          BigInt(100),
        );
        if (decision === "prompt") {
          const displayedC = (Number(displayedBps) / 100).toFixed(0);
          const currentC = (Number(freshVwap.avgPriceBps) / 100).toFixed(0);
          const ok = window.confirm(
            `Price moved from ${displayedC}¢ to ${currentC}¢. Continue at ${currentC}¢?`,
          );
          if (!ok) {
            // User declined — bail out. The mutation's onError will
            // surface a friendly toast via formatUserFacingError.
            throw new Error("Cancelled — price moved beyond your slippage tolerance.");
          }
        }
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
      // Phase2-C: explicit expiry mode chosen by the user.
      //   "never" → expiry=0 (matching engine's "no expiry" sentinel)
      //   "1h"    → now + 3600 (legacy default; kept for users who want it)
      //   "close" → market.endTime (default; expires at market close)
      const expiry =
        expiryMode === "never"
          ? 0
          : expiryMode === "1h"
            ? Math.floor(Date.now() / 1000) + 3600
            : market.endTime;
      const typeNum = ORDER_TYPE_U8[orderType];
      const priceNum = orderType === "MARKET" ? 0 : limitPrice;

      // Order maker is the EOA — that's where USDT lives in the Path-1
      // architecture (no smart account in the trading path). Settlement's
      // `SignatureChecker.isValidSignatureNow` falls through to ECDSA when
      // maker has no contract code, accepting plain EOA signatures.
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
      track("order_placed", {
        type: orderType,
        side: orderSide === 0 ? "BUY" : "SELL",
        option: side === 1 ? "UP" : "DOWN",
        pair: market?.pairSymbol ?? "unknown",
        amountUsd: stakeUsd,
        priceCents: orderType === "MARKET" ? null : Math.round(limitPrice / 100),
      });
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

  // Phase2-PRE bug fix: when the market is terminal (RESOLVED/CLAIMED/
  // TRADING_ENDED) replace the trade form with a closed-state panel. Prior
  // behavior left the full Buy/Sell UI rendered with only the submit button
  // disabled — UP/DOWN selector, type pill, size input, and fee math all
  // stayed interactive and visually live.
  if (market && isTerminalMarketStatus(market.status)) {
    return <MarketClosedPanel market={market} />;
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

      {/* Phase2-C: BIG UP / DOWN side selector — Polymarket-parity. Each
          button shows the current implied probability (mid in cents) for
          its side. Click to choose which outcome to trade.

          For BUY: the price the user effectively pays settles into Total +
          fee math via `effectivePriceCents` (best ASK / mid fallback).
          For SELL: the price they effectively receive does the same via
          best BID / mid. Both side buttons display the MID so the user
          always sees the live probability of both outcomes. */}
      <div className="pp-trade__ud">
        <button
          type="button"
          className={cn("pp-trade__udbtn", side === 1 && "pp-trade__udbtn--up-on")}
          onClick={() => {
            setSide(1);
            if (!isConnected) scrollToConnect();
          }}
        >
          <span>▲ Up</span>
          <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: 18, fontWeight: 600 }}>
            {Math.round(upMidCents)}¢
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
          <span>▼ Down</span>
          <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: 18, fontWeight: 600 }}>
            {Math.round(downMidCents)}¢
          </span>
        </button>
      </div>

      {/* Limit price — only visible when the order type rests on the book.
          Pre-fills with the auto-derived cents (best-ask + 50 bps / best-bid
          − 50 bps) so the user sees a sensible number they can edit in place. */}
      {orderType !== "MARKET" && (
        <div className="mt-3">
          <label className="pp-micro" htmlFor="limit-price-cents">
            Limit price · cents
          </label>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              className="pp-btn pp-btn--secondary pp-btn--sm"
              onClick={() => {
                const cur = userPriceCentsInput === "" ? autoCentsDisplay : Number(userPriceCentsInput);
                const next = Math.max(1, (Number.isFinite(cur) ? cur : 0) - 1);
                setUserPriceCentsInput(String(next));
              }}
              aria-label="Decrease limit price by 1¢"
            >
              −
            </button>
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
            <button
              type="button"
              className="pp-btn pp-btn--secondary pp-btn--sm"
              onClick={() => {
                const cur = userPriceCentsInput === "" ? autoCentsDisplay : Number(userPriceCentsInput);
                const next = Math.min(99, (Number.isFinite(cur) ? cur : 0) + 1);
                setUserPriceCentsInput(String(next));
              }}
              aria-label="Increase limit price by 1¢"
            >
              +
            </button>
            <span className="pp-caption" style={{ marginLeft: "auto" }}>
              {limitPrice} bps
            </span>
          </div>
          {priceInputInvalid && (
            <p id="limit-price-hint" className="pp-caption mt-1 pp-down">
              {userPriceParsed.error}
            </p>
          )}
        </div>
      )}

      {/* PR-18 P1-19: USD stake input + $N quick-add. Polymarket-parity:
          user enters dollar amount; shares acquired computed from price.
          Backend wire amount stays atomic-USDT (= our model's "shares"
          1:1) so the signing path is unchanged — see PR-18 design §5
          wire-shape note. */}
      <div className="mt-3">
        <label className="pp-micro" htmlFor="trade-stake">
          Stake (USD)
        </label>
        <div className="mt-1 flex items-center gap-2">
          <span
            className="pp-tabular"
            style={{ color: "var(--fg-2)", fontWeight: 600 }}
            aria-hidden
          >
            $
          </span>
          <input
            id="trade-stake"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={stakeUsdInput}
            onChange={(e) => {
              // Allow empty / partial / decimal. Strip anything that
              // isn't digits-or-dot. Number-coerce at use-sites.
              const raw = e.target.value.replace(/[^0-9.]/g, "");
              // Disallow more than one decimal point.
              const parts = raw.split(".");
              const cleaned = parts.length > 2
                ? `${parts[0]}.${parts.slice(1).join("")}`
                : raw;
              setStakeUsdInput(cleaned);
            }}
            onFocus={(e) => e.currentTarget.select()}
            className={cn(
              "pp-input pp-input--mono flex-1 text-right",
              stakeOutOfRange && "pp-input--invalid",
            )}
            aria-invalid={stakeOutOfRange}
          />
        </div>
        <div className="pp-trade__presets mt-2">
          {STAKE_QUICK_ADDS.map((qa, i) =>
            qa.kind === "max" ? (
              <button
                key="max"
                type="button"
                className="pp-trade__preset"
                onClick={() => {
                  // PR-18: "Max" = min(availableBalance, MAX_STAKE_USDT).
                  // Available balance integration arrives in PR-18 part 4
                  // (P0-11 gate). Until then, Max fills MAX_STAKE_USDT —
                  // the user-facing cap — and the part-4 commit narrows
                  // it by the actual on-chain balance.
                  setStakeUsdInput(maxStakeForBalance(BigInt(MAX_STAKE_USDT) * BigInt(1_000_000)));
                }}
                aria-label="Set stake to max"
              >
                Max
              </button>
            ) : (
              <button
                key={`add-${qa.usd}-${i}`}
                type="button"
                className="pp-trade__preset"
                onClick={() => {
                  const cur = parseFloat(stakeUsdInput);
                  const base = Number.isFinite(cur) && cur > 0 ? cur : 0;
                  setStakeUsdInput((base + qa.usd).toFixed(2));
                }}
              >
                +${qa.usd}
              </button>
            ),
          )}
          <button
            type="button"
            className="pp-trade__preset"
            onClick={() => setStakeUsdInput("")}
            aria-label="Clear stake"
          >
            Clear
          </button>
        </div>
        {stakeOutOfRange ? (
          <p className="pp-caption mt-1 pp-down">
            Stake must be ${MIN_STAKE_USDT}–${MAX_STAKE_USDT}.
          </p>
        ) : null}
      </div>

      {/* PR-18 P1-19: USD-stake summary. Stake first (the user's input),
          then derived shares-acquired, then To-win and net profit.
          Polymarket parity. */}
      <div className="pp-trade__summary">
        <div className="flex items-baseline justify-between">
          <span className="pp-micro">{orderSide === 0 ? "You spend" : "You receive"}</span>
          <span className="pp-tabular" style={{ color: "var(--fg-0)", fontWeight: 600 }}>
            ${stakeUsd.toFixed(2)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="pp-micro">Shares acquired</span>
          <span className="pp-tabular" style={{ color: "var(--fg-1)" }}>
            {sharesPreview.toFixed(2)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="pp-micro">
            {orderSide === 0 ? "To win" : "Exposure if " + (side === 1 ? "Up" : "Down") + " wins"}
          </span>
          <span
            className="pp-tabular"
            style={{
              color: orderSide === 0 ? "var(--up)" : "var(--fg-2)",
              fontWeight: 500,
            }}
          >
            ${toWinUsd.toFixed(2)}
          </span>
        </div>
        {orderSide === 0 ? (
          <div className="flex items-baseline justify-between">
            <span className="pp-micro">Net profit if {side === 1 ? "Up" : "Down"} wins</span>
            <span className="pp-tabular pp-up" style={{ fontWeight: 500 }}>
              +${profitIfBuyWin.toFixed(2)}
            </span>
          </div>
        ) : null}
        <div className="pp-caption" style={{ marginTop: 4 }}>
          Fee:{" "}
          <span className="pp-tabular" style={{ color: "var(--fg-0)" }}>
            ${feeUsdDisplay.toFixed(2)} ({effectivePercentOfNotional.toFixed(2)}% at {shareCentsLabel})
          </span>
          <InfoTip
            text={`Peak ${peakFeePct}% at 50¢. Probability-weighted, tapers at extremes.`}
          />
        </div>
        {rebateBps != null && rebateBps > 0 ? (
          <div className="pp-caption pp-up" style={{ fontWeight: 500 }}>
            Earns {(rebateBps / 100).toFixed(2)}% rebate on this fill
          </div>
        ) : null}
      </div>

      {/* Phase2-C: Expires dropdown. Default "Until close" — typical
          prediction-market expectation is the order vanishes when the
          market window closes. Long-press not used here; segmented buttons
          are clearer than a dropdown for 3 options. */}
      <div className="mt-3">
        <label className="pp-micro">Expires</label>
        <div className="pp-seg mt-1">
          {EXPIRY_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={cn("pp-seg__btn", expiryMode === m.id && "pp-seg__btn--on")}
              onClick={() => setExpiryMode(m.id)}
              title={m.hint}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Submit / connect */}
      {isConnected ? (
        <button
          type="button"
          disabled={
            submit.isPending ||
            !isMarketTradeable ||
            priceInputInvalid ||
            !smartAccount ||
            stakeUsd <= 0 ||
            stakeOutOfRange ||
            noLiquidity ||
            insufficientDepth ||
            geoBlocked
          }
          title={
            geoBlocked
              ? "Not available in your region"
              : !isMarketTradeable
                ? "Market is closing — pick the next live market"
                : priceInputInvalid
                  ? (userPriceParsed.error ?? "Fix price before submitting")
                  : !smartAccount
                    ? "Finish wallet sign-in to enable trading"
                    : stakeUsd <= 0
                      ? "Enter a stake amount"
                      : stakeOutOfRange
                        ? `Stake must be $${MIN_STAKE_USDT}–$${MAX_STAKE_USDT}`
                        : noLiquidity
                          ? `No liquidity on ${side === 1 ? "Up" : "Down"} ${orderSide === 0 ? "asks" : "bids"} — try a Limit order or wait for new orders`
                          : insufficientDepth
                            ? `Insufficient liquidity for $${stakeUsd.toFixed(2)} stake (max $${insufficientDepthMaxUsd.toFixed(2)} available now)`
                            : undefined
          }
          className={cn(
            "pp-btn pp-btn--lg pp-trade__cta",
            side === 1 ? "pp-btn--up" : "pp-btn--down",
          )}
          onClick={() => {
            // WS3 PR C: defense-in-depth — even if the geo overlay is
            // removed via DevTools, we don't let a restricted visitor
            // produce a signed payload.
            if (geoBlocked) return;
            // WS2 PR B: gate the first trade behind Terms acceptance for the
            // connected wallet. After accept, the user clicks Trade again —
            // we deliberately don't auto-resubmit so the price they see at
            // the moment they confirm is the price they signed for (no
            // hidden re-fetch between accept and signature).
            if (address && !hasAcceptedCurrentVersion(address)) {
              setTermsModalOpen(true);
              return;
            }
            submit.mutate();
          }}
        >
          {submit.isPending
            ? "Signing…"
            : stakeUsd <= 0
              ? "Trade"
              : `${orderSide === 0 ? "Buy" : "Sell"} $${stakeUsd.toFixed(2)} of ${side === 1 ? "Up" : "Down"} · ${sharesPreview.toFixed(2)} shares @ ${Math.round(effectivePriceCents)}¢`}
        </button>
      ) : (
        <div
          ref={connectSectionRef}
          className="mt-3 rounded-[6px] border p-3"
          style={{ background: "var(--bg-0)", borderColor: "var(--border-0)" }}
        >
          <p className="pp-body-strong text-center">Connect wallet to trade</p>
          <p className="pp-caption mt-1 text-center">
            Choose a wallet. Side and size can be adjusted before signing.
          </p>
          <WalletConnectorList className="mt-3" />
        </div>
      )}

      <TermsAcceptanceModal
        open={termsModalOpen}
        wallet={address ?? null}
        onAccepted={() => setTermsModalOpen(false)}
        onDismiss={() => setTermsModalOpen(false)}
      />
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

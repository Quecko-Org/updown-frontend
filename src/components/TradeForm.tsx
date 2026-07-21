"use client";

import { Info } from "lucide-react";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useAccount } from "wagmi";
import { erc20Abi } from "viem";
import { createPublicClient, http } from "viem";
import {
  ALCHEMY_RPC_URL,
  activeChain,
  tokenSymbolForActiveChain,
  FAUCET_ENABLED,
  FAUCET_LABEL_SUFFIX,
  SESSION_USDT_ALLOWANCE_BASE_UNITS,
} from "@/config/environment";
import { postDevmintUsdt } from "@/lib/api";
import { toast } from "sonner";
import {
  getBalance,
  getConfig,
  getMarket,
  getOrderbook,
  getPositions,
  postOrder,
  ORDER_TYPE_U8,
  type OrderApiType,
  type OrderBookResponse,
} from "@/lib/api";
import { buildOrderTypedData } from "@/lib/eip712";
import { assertPinnedApproval } from "@/lib/pinnedAddresses";
import {
  deriveEffectiveStatus,
  formatPriceCents,
  stepPriceBps,
  validateLimitPriceCents,
} from "@/lib/derivations";
import { formatBookPriceCents, parseUsdtToAtomic } from "@/lib/format";
import {
  bestEffectivePriceCents,
  estimateTotalFee,
  formatShareCentsLabel,
  sharePriceBpsFromOrderBookMid,
} from "@/lib/feeEstimate";
import {
  buyerLockAtomic as computeBuyerLockAtomic,
  slippageDecision,
  usdToShares,
  walkBookForAvgFillPrice,
  walkBookForBudget,
} from "@/lib/orderBookFill";
import { nonCrossingExecutableBps, unifyOrderBook } from "@/lib/unifiedBook";
import { COMPLEMENTARY_MATCHING_ENABLED } from "@/config/environment";
import {
  MAX_STAKE_ATOMIC,
  MAX_STAKE_USDT,
  MIN_STAKE_USDT,
  maxStakeForBalance,
} from "@/lib/stakeBounds";
import { computeMarketSlippagePrice } from "@/lib/orderConstants";
import { parseCompositeMarketKey } from "@/lib/marketKey";
import { cn } from "@/lib/cn";
import { formatUserFacingError } from "@/lib/errors";
import { sessionOrdersEnabled } from "@/lib/accountKit";
import { track } from "@/lib/analytics";
import { isTerminalMarketStatus } from "@/lib/derivations";
import { EmptyState } from "@/components/EmptyState";
import { WalletConnectorList } from "@/components/WalletConnectorList";
import { MarketClosedPanel } from "@/components/MarketClosedPanel";
import { TermsAcceptanceModal } from "@/components/TermsAcceptanceModal";
import { hasAcceptedCurrentVersion } from "@/lib/termsAcceptance";
import { geoStateAtom, userSmartAccount, userSmartAccountClient } from "@/store/atoms";

// PR-18: USD-stake-based UI presets. Polymarket-parity. The +$X buttons
// add to whatever value is currently in the stake input; "Max" fills with
// `min(availableBalance, MAX_STAKE_USDT)` per the lib/stakeBounds clamp.
type StakeQuickAdd = { kind: "add"; usd: number } | { kind: "max" };
// 2026-05-16 BUG A redesign: chip set tuned to Myriad's increment ladder
// (smaller granular adds + a punch-in $100). +$1 caters to the share-by-share
// experimenters; +$100 stays as the "real bet" quick-set.
const STAKE_QUICK_ADDS: StakeQuickAdd[] = [
  { kind: "add", usd: 1 },
  { kind: "add", usd: 5 },
  { kind: "add", usd: 10 },
  { kind: "add", usd: 100 },
  { kind: "max" },
];

export type ExpiryMode = "1h" | "close";

/**
 * There is no "Never" mode. UpDownSettlement reverts `OrderExpired` on
 * `block.timestamp > order.expiry`, so an expiry of 0 is not "never expires",
 * it is never SETTLES: the order matches, gets a Trade row, and then fails
 * settlement forever. Every mode here must therefore produce a future
 * timestamp, bounded by the market's own close — an order cannot usefully
 * outlive the market it trades.
 */
export const EXPIRY_MODES: { id: ExpiryMode; label: string; hint: string }[] = [
  { id: "close", label: "Until close", hint: "expires when market resolves" },
  { id: "1h", label: "1 hour", hint: "expires in 60 min" },
];

/**
 * The unix-second expiry a mode signs into the EIP-712 order payload. Exported
 * for the sibling test: the expiry is part of the signed digest, so this value
 * is what the FE both signs AND posts — it is never rewritten server-side.
 *
 * "1h" is deliberately NOT clamped to `marketEndTime`. An expiry beyond close
 * costs nothing (the engine sweeps the order at MARKET_ENDED regardless) and a
 * LATER expiry is strictly safer on-chain: it is the settlement tx's inclusion
 * time, not the match time, that the contract compares against.
 */
export function expiryForMode(mode: ExpiryMode, marketEndTime: number, nowMs = Date.now()): number {
  return mode === "1h" ? Math.floor(nowMs / 1000) + 3600 : marketEndTime;
}

// Ordered so the compact pill's short-click (Market ↔ Limit) matches index 0 / 1;
// long-press reveals the full list including POST_ONLY + IOC.
const ORDER_TYPES: { id: OrderApiType; label: string; hint?: string }[] = [
  { id: "MARKET", label: "Market", hint: "fill now" },
  { id: "LIMIT", label: "Limit", hint: "rest on book" },
  { id: "POST_ONLY", label: "Post-only", hint: "maker only" },
  { id: "IOC", label: "IOC", hint: "fill or cancel" },
];

const LONG_PRESS_MS = 400;

// Issue #2: how long the in-memory book must read empty CONTINUOUSLY before the
// CTA treats it as real "no liquidity" and disables. Longer than the 2s REST
// refetch on `fullOrderbook` so a poll always gets a chance to rehydrate a
// genuinely-populated book before we confirm — absorbs the transient WS blanks
// (DMM cancel-then-replace, single-option frame before the counterpart hydrates).
const NO_LIQUIDITY_CONFIRM_MS = 2500;

// How long a resting-LIMIT non-crossing state must hold before the "your order
// will rest" hint toggles. Same anti-flicker idea as NO_LIQUIDITY_CONFIRM_MS
// (Issue #2) but far shorter: this hint is informational and non-blocking, and
// the WS handler's last-known-good guard already drops empty-clobber snapshots,
// so it only needs to ride out sub-second book wobble (a DMM cancel-replace),
// not a full REST-poll gap — and typed-price feedback should still feel prompt.
const NON_CROSSING_HINT_DEBOUNCE_MS = 600;

/**
 * Settlement allowance policy.
 *
 * `APPROVAL_AMOUNT` is what we grant; `APPROVAL_TOP_UP_THRESHOLD` is when we
 * re-grant. It used to be an unlimited (MAX_UINT256) approval, which made the
 * settlement address — server-supplied, see `ensureSettlementAllowance` — able
 * to `transferFrom` the SCA's entire USDT balance forever. A finite allowance
 * caps that at `APPROVAL_AMOUNT`, which is far above any demo-sized position and
 * tunable per box via `NEXT_PUBLIC_SESSION_USDT_ALLOWANCE` (default 10,000 USDT).
 *
 * The threshold MUST stay well below the amount: they are the two ends of one
 * loop, and setting them equal would re-approve (a UserOp, and real gas on the
 * self-paid demo box) after every single fill. At 10% we top up once per ~9,000
 * USDT of fills instead.
 */
const APPROVAL_AMOUNT = SESSION_USDT_ALLOWANCE_BASE_UNITS;
const APPROVAL_TOP_UP_THRESHOLD = APPROVAL_AMOUNT / BigInt(10);

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
  const ak = useAtomValue(userSmartAccountClient);
  const geo = useAtomValue(geoStateAtom);
  const geoBlocked = geo.status === "restricted";
  // F3 (2026-05-16): self-funding affordance. Visible on Sepolia, or on the
  // mock demo stack when NEXT_PUBLIC_ENABLE_FAUCET=1 (see FAUCET_ENABLED);
  // absent on real production builds.
  const tokenSymbolForChain = tokenSymbolForActiveChain();
  const [mintingTestUsdt, setMintingTestUsdt] = useState(false);
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
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>("close");
  const [otypeMenuOpen, setOtypeMenuOpen] = useState(false);
  // 2026-05-16 BUG A redesign: full payoff breakdown collapses behind a
  // Details ▾ accordion so the primary panel surfaces only the two
  // numbers Polymarket / Myriad lead with — "To Win" + "Avg Price".
  // The detailed numbers (You spend / Shares / Fee / Net profit / Rebate)
  // are retained and reachable, just one click deeper.
  const [detailsOpen, setDetailsOpen] = useState(false);
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

    // Side pre-selection. Accepts both the legacy numeric form (?side=1|2)
    // and the human-readable form (?side=up|down) emitted by home-page
    // OpenMarketRow links (2026-05-16 BUG A redesign — see
    // `markets/OpenMarketRow.tsx`).
    const sideParam = searchParams.get("side");
    if (sideParam === "1" || sideParam === "up") setSide(1);
    else if (sideParam === "2" || sideParam === "down") setSide(2);

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

  // PR-Z (2026-05-20): the `dmmStatus` useQuery against `/dmm/list` was
  // hitting a backend endpoint deleted in the 2026-05-12 rebate rebuild
  // (404 on every mount). The per-trade "Maker rebate" details row that
  // depended on `dmmStatus?.isDmm` is removed below — anyone making a
  // SELL fill accrues rebates, but the per-trade preview wasn't accurate
  // because it'd appear on BUY tickets too (BUY-side never makes a fill).
  // Rebate accounting lives on `/rebates`.

  // PR-18 P0-11: available-balance gate. Pull the user's off-chain
  // available USDT (cachedBalance - inOrders) so we can disable submit
  // BEFORE the wallet popup if their stake exceeds available. Same
  // queryKey as Header — React Query dedupes, no extra request.
  // 2026-05-16: query the trading identity (smartAccount when present,
  // else EOA). Balance lives on the ThinWallet, so keying on the raw
  // EOA returns 0 and falsely fires "Insufficient balance" for users
  // with ThinWallet-held USDT.
  const tradingIdentity = smartAccount || address;
  const { data: balanceData } = useQuery({
    queryKey: ["balance", tradingIdentity?.toLowerCase() ?? ""],
    queryFn: () => getBalance(tradingIdentity!),
    enabled: !!tradingIdentity && isConnected,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
  const availableUsdAtomic = useMemo(() => {
    if (!balanceData) return BigInt(0);
    try {
      return BigInt(balanceData.available);
    } catch {
      return BigInt(0);
    }
  }, [balanceData]);

  // SELL side is bounded by the SHARES you hold in this market+outcome, not
  // your USDT balance. Fetch the trading identity's positions (same source
  // the submit-time precheck at the sign step uses) so the "Available" label,
  // the "Max" chip, and the pre-sign gate all reflect real holdings instead
  // of falling back to USDT. Same query cadence as the balance query above;
  // React Query dedupes with the Portfolio page's identical key.
  const { data: positionsData } = useQuery({
    queryKey: ["positions", tradingIdentity?.toLowerCase() ?? ""],
    queryFn: () => getPositions(tradingIdentity!),
    enabled: !!tradingIdentity && isConnected,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
  // Owned shares (atomic, 6-dec; 1 share = $1 face) for the CURRENT market +
  // selected direction. `option === side` (1=UP, 2=DOWN) matches the wire the
  // same way the sign-step precheck does.
  const ownedSharesAtomic = useMemo(() => {
    if (!positionsData || !parsedKey) return BigInt(0);
    const match = positionsData.find(
      (p) =>
        p.market.toLowerCase() === parsedKey.composite.toLowerCase() &&
        p.option === side,
    );
    if (!match) return BigInt(0);
    try {
      return BigInt(match.shares);
    } catch {
      return BigInt(0);
    }
  }, [positionsData, parsedKey, side]);

  /**
   * One-time-per-wallet onboarding UserOp: DEPLOY the user's SCA (if still
   * counterfactual) and `USDT.approve(settlement, APPROVAL_AMOUNT)` in a single
   * UserOp via Account Kit. Satisfies both hard rules from the change
   * design: deploy-before-fill (the on-chain ERC-1271 check needs code at
   * `maker`) and the allowance `enterPosition`'s `transferFrom` needs.
   *
   * Gas: per the configured mode — the demo runs SELF-PAID (the SCA holds a
   * dust of ETH seeded by the dev faucet); production uses an Alchemy Gas
   * Manager policy (sponsored, or user-paid-in-USDC for ERC-20-type policies).
   */
  const ensureSettlementAllowance = useCallback(async () => {
    if (!cfg || !ak) return;
    if (!smartAccount) return; // wait for Account Kit connect to complete
    // Approve THIS market's settlement, not the top-level (first-pair) one:
    // on a multi-settlement deployment each market has its own settlement and
    // `enterPosition`'s transferFrom pulls from that contract. `parsedKey`
    // carries the selected market's settlement (lowercased); the demo shares a
    // single settlement so this equals `cfg.eip712.domain.verifyingContract`.
    const settlement = (parsedKey?.settlement ??
      cfg.eip712.domain.verifyingContract) as `0x${string}`;
    const usdt = cfg.usdtAddress as `0x${string}`;
    // Both of the above are server-supplied (`parsedKey.settlement` is parsed
    // out of the composite key `GET /markets` returns), and an allowance is
    // irrevocable value: pin before granting, never after.
    assertPinnedApproval({ settlement, usdt });
    const sca = smartAccount as `0x${string}`;
    const pub = createPublicClient({ chain: activeChain, transport: http(ALCHEMY_RPC_URL) });
    const current = (await pub.readContract({
      address: usdt,
      abi: erc20Abi,
      functionName: "allowance",
      args: [sca, settlement],
    })) as bigint;
    if (current >= APPROVAL_TOP_UP_THRESHOLD) return;
    track("approve_attempted");

    // Self-paid mode precondition: the SCA needs ETH for its one UserOp. With a
    // gas policy set the UserOp is sponsored (and, in sponsored-transfer mode,
    // billed back in USDTm) — the SCA never needs ETH, so this must NOT fire.
    // The dev faucet (`POST /test/devmint`) seeds ETH alongside the USDTM mint;
    // fail with actionable copy instead of a bundler error.
    if (!process.env.NEXT_PUBLIC_ALCHEMY_GAS_POLICY_ID?.trim()) {
      const ethBal = await pub.getBalance({ address: sca });
      if (ethBal === BigInt(0)) {
        throw new Error(
          // "one-time approval", not "on-chain setup": this fires when the
          // ALLOWANCE is missing, which has nothing to do with deployment. The
          // old wording sent people hunting for an undeployed account (an
          // already-deployed, already-funded SCA hits this too).
          `Your trading account ${sca} needs a one-time approval before its first trade, but has no ETH for gas. Use the "Get 100 USDT (demo)" faucet (it seeds gas too), or send ~0.001 ETH to that address — it's your trading account, not your MetaMask address.`,
        );
      }
    }

    toast.info("Setting up your trading account… one-time approval, confirm in your wallet.");
    const txHash = await ak.onboard({ usdt, settlement, amount: APPROVAL_AMOUNT });
    track("approve_succeeded", { txHash });
  }, [cfg, ak, smartAccount, parsedKey]);

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
  const userOverrideActive = userPriceCentsInput !== "" && userPriceParsed.bps != null;
  const limitPrice = userOverrideActive ? (userPriceParsed.bps as number) : autoLimitPrice;
  // Show the auto price at the book's real resolution. Rounding this to whole
  // cents made the field read "60" while the order actually signed at 5972 bps
  // (59.72¢), so stepping down from it jumped to 59.00¢ and silently stopped
  // crossing the ask.
  const autoCentsDisplay = formatPriceCents(autoLimitPrice);
  const priceInputInvalid = userPriceCentsInput !== "" && userPriceParsed.bps == null;

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

  // PR-18 P1-19: the user's raw input in atomic-USDT (6-dec). Its meaning
  // depends on side (see `orderAmountAtomic` below):
  //   - BUY  → a $ BUDGET to spend.
  //   - SELL → a SHARE count to sell (1 share = $1 face; Polymarket parity).
  const stakeAtomicForVwap = useMemo(() => {
    const usd = parseFloat(parseFloat(stakeUsdInput).toFixed(2));
    if (!Number.isFinite(usd) || usd <= 0) return BigInt(0);
    return parseUsdtToAtomic(usd.toFixed(2));
  }, [stakeUsdInput]);

  // PR-18 P0-19: order-book walk for MARKET orders. NEVER falls back to
  // midpoint/top-of-book when the order walks multiple levels.
  //   - BUY:  spend the $ budget across the ASKS → shares bought + VWAP paid.
  //           (`walkBookForBudget`, the fix for the "$10 buys $5" bug — the
  //           wire `amount` is a SHARE count, so a $ budget MUST be converted
  //           to shares against the live book before signing.)
  //   - SELL: sell the share count across the BIDS → VWAP received
  //           (`walkBookForAvgFillPrice`, shares walked against share-depth).
  const vwapResult = useMemo(() => {
    if (orderType !== "MARKET") return null;
    if (!fullOrderbook) return null;
    if (stakeAtomicForVwap <= BigInt(0)) return null;
    // Complementary matching: a BUY UP can also fill against DOWN buy-side demand
    // (mint) and a SELL UP against DOWN sell-side supply (merge). The unified view
    // folds that synthetic liquidity into this side's asks/bids so the VWAP + depth
    // gates reflect what the engine can actually cross. Off → the raw side book.
    const unified = unifyOrderBook(fullOrderbook, COMPLEMENTARY_MATCHING_ENABLED);
    const sideBook = side === 1 ? unified.up : unified.down;
    if (orderSide === 0 /* BUY: walk asks by budget */) {
      const w = walkBookForBudget(sideBook.asks, stakeAtomicForVwap);
      return {
        avgPriceBps: w.avgPriceBps,
        requiresMoreDepth: w.requiresMoreDepth,
        buyerSharesAtomic: w.sharesAtomic,
        // Max the budget can actually spend, for the insufficient-depth copy.
        fillableUsd: Number(w.spentAtomic) / 1_000_000,
      };
    }
    // SELL: walk bids by share quantity.
    const w = walkBookForAvgFillPrice(sideBook.bids, stakeAtomicForVwap);
    return {
      avgPriceBps: w.avgPriceBps,
      requiresMoreDepth: w.requiresMoreDepth,
      buyerSharesAtomic: BigInt(0),
      fillableUsd: Number(w.fillableAtomic) / 1_000_000,
    };
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

  // Phase2-C: the share price feeding fee math is the EFFECTIVE price the
  // trade fills at, not the order-book mid.
  const sharePriceBps = useMemo(
    () => Math.max(1, Math.min(9999, Math.round(effectivePriceCents * 100))),
    [effectivePriceCents],
  );

  // Depth-availability flags for the disabled-button gate.
  //
  // `noLiquidityTransient` is the INSTANTANEOUS read of the in-memory (unified)
  // book: true the moment a MARKET order finds no crossable asks/bids. But that
  // book blanks transiently — the DMM cancel-then-replaces a side, and a
  // single-option WS frame can land before the counterpart rehydrates, which
  // collapses the synthetic asks (folded from the opposite option's bids) to
  // empty for a tick. So this instantaneous value must NOT drive the disable /
  // click-gate on its own (Issue #2): it flickers, and a real order that a
  // fresh fetch would fill gets wrongly blocked. See `noLiquidity` (debounced)
  // below for the value the CTA actually gates on.
  const noLiquidityTransient =
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
    return vwapResult.fillableUsd;
  }, [insufficientDepth, vwapResult]);

  // Issue #2: debounce the "no liquidity" DISABLE decision. `noLiquidityTransient`
  // flickers true whenever the in-memory book momentarily blanks (WS cancel-then-
  // replace, or a single-option frame before the counterpart hydrates). Only treat
  // it as REAL once it has held continuously for NO_LIQUIDITY_CONFIRM_MS — longer
  // than the 2s REST refetch on `fullOrderbook`, so a poll always gets a chance to
  // rehydrate a genuinely-populated book before we confirm. A truly empty book
  // stays empty across polls → confirms → CTA disables; the authoritative check is
  // still the submit-time fresh fetch + walkBook guard in `submit`, which throws a
  // precise error, so a debounced FALSE never lets an unfillable order through.
  // (NO_LIQUIDITY_CONFIRM_MS is module-scoped so it's stable across renders.)
  const [noLiquidity, setNoLiquidity] = useState(false);
  useEffect(() => {
    if (!noLiquidityTransient) {
      setNoLiquidity(false);
      return;
    }
    const id = setTimeout(() => setNoLiquidity(true), NO_LIQUIDITY_CONFIRM_MS);
    return () => clearTimeout(id);
  }, [noLiquidityTransient]);

  // Best executable prices from the unified (complementary) book: the synthetic
  // ask a BUY must reach, and the bid a SELL must reach. Same transform the VWAP
  // walk uses — here only top-of-book is needed, to tell a resting LIMIT from a
  // marketable one. Asks sort ascending / bids descending, so [0] is best.
  const executableTopOfBook = useMemo<{
    bestAskBps: number | null;
    bestBidBps: number | null;
  }>(() => {
    if (!fullOrderbook) return { bestAskBps: null, bestBidBps: null };
    const unified = unifyOrderBook(fullOrderbook, COMPLEMENTARY_MATCHING_ENABLED);
    const sideBook = side === 1 ? unified.up : unified.down;
    return {
      bestAskBps: sideBook.asks[0]?.price ?? null,
      bestBidBps: sideBook.bids[0]?.price ?? null,
    };
  }, [fullOrderbook, side]);

  // The executable price (bps) a resting LIMIT order fails to reach, or null
  // when it's marketable / MARKET / there's no book to compare against. QA
  // round-5: a manually-typed 50¢ BUY reads "To Win $20" but rests below the
  // 50.5¢ synthetic ask; this surfaces that instead of a silent no-op order.
  const nonCrossingExecBps = useMemo(() => {
    if (orderType === "MARKET") return null;
    return nonCrossingExecutableBps({
      orderSide,
      limitBps: limitPrice,
      bestAskBps: executableTopOfBook.bestAskBps,
      bestBidBps: executableTopOfBook.bestBidBps,
    });
  }, [orderType, orderSide, limitPrice, executableTopOfBook]);

  // Debounce the hint's displayed value the same way the CTA debounces "no
  // liquidity" — the unified book can wobble for a tick on a DMM cancel-replace,
  // so hold the last value through a transient blank instead of flickering the
  // hint off and back on. Null (marketable / no book) settles to hidden.
  const [nonCrossingHintBps, setNonCrossingHintBps] = useState<number | null>(null);
  useEffect(() => {
    const id = setTimeout(
      () => setNonCrossingHintBps(nonCrossingExecBps),
      NON_CROSSING_HINT_DEBOUNCE_MS,
    );
    return () => clearTimeout(id);
  }, [nonCrossingExecBps]);

  // PR-18 P1-19: the $ budget the user typed. BUY only — for SELL the input
  // is a share count (see `orderAmountAtomic`). Parse tolerantly.
  const stakeUsd = useMemo(() => {
    const n = parseFloat(stakeUsdInput);
    if (!Number.isFinite(n) || n <= 0) return 0;
    // Round to cents to match the wire's 2dp atomic-USDT precision.
    return Math.round(n * 100) / 100;
  }, [stakeUsdInput]);

  // ── THE FIX ─────────────────────────────────────────────────────────
  // The wire `Order.amount` is a SHARE count: the contract does
  // `userShares[buyer] += fillAmount` and charges `cost = price × fillAmount
  // / 10000`. Signing the raw $ figure as `amount` (the old bug) made "$10"
  // buy 10 shares — costing `price × 10 / 10000` = $5 at a 50¢ ask. Convert
  // the budget to shares against the live fill price so a $10 buy spends ~$10.
  //   - BUY MARKET: shares the budget buys walking the asks (VWAP).
  //   - BUY LIMIT:  budget ÷ limit price (fills at ≤ that price → spend ≤ budget).
  //   - SELL:       the share count the user typed, 1:1.
  const orderAmountAtomic = useMemo<bigint>(() => {
    if (stakeAtomicForVwap <= BigInt(0)) return BigInt(0);
    if (orderSide === 1 /* SELL */) return stakeAtomicForVwap;
    if (orderType === "MARKET") return vwapResult?.buyerSharesAtomic ?? BigInt(0);
    return usdToShares(stakeAtomicForVwap, BigInt(sharePriceBps));
  }, [stakeAtomicForVwap, orderSide, orderType, vwapResult, sharePriceBps]);

  // Shares acquired (BUY) / sold (SELL). Atomic → display units (1 share = $1).
  const sharesPreview = useMemo(
    () => Number(orderAmountAtomic) / 1_000_000,
    [orderAmountAtomic],
  );

  // Cash side of the trade: `price × amount / 10000`.
  //   - BUY  → what the user actually spends (≈ their budget).
  //   - SELL → the proceeds received.
  const notionalUsd = useMemo(() => {
    if (orderAmountAtomic <= BigInt(0)) return 0;
    const cost = (orderAmountAtomic * BigInt(sharePriceBps)) / BigInt(10000);
    return Number(cost) / 1_000_000;
  }, [orderAmountAtomic, sharePriceBps]);

  const stakeOutOfRange =
    stakeUsd > 0 && (stakeUsd < MIN_STAKE_USDT || stakeUsd > MAX_STAKE_USDT);

  // The MARKET slippage cap in bps: the price `submit` actually SIGNS for a
  // MARKET order (the VWAP is only the expected fill). Null for LIMIT-family
  // orders, and null when there's no book to cap against.
  const marketSlippagePriceBps = useMemo(() => {
    if (orderType !== "MARKET") return null;
    return computeMarketSlippagePrice({ orderSide, bestPriceBps: sharePriceBps });
  }, [orderType, orderSide, sharePriceBps]);

  // The price the order is signed at, which is what the backend locks against:
  // the limit for LIMIT/POST_ONLY/IOC, the slippage CAP for MARKET.
  const signedPriceBpsForLock =
    orderType === "MARKET" ? (marketSlippagePriceBps ?? sharePriceBps) : sharePriceBps;

  // The buyer's true worst-case cash obligation (cost + signed fee cap),
  // mirroring the backend's `buyerLock` in MatchingEngine.addOrder. Shared
  // definition — see `buyerLockAtomic` in @/lib/orderBookFill.
  const buyerLockAtomic = useMemo(
    () =>
      computeBuyerLockAtomic(
        orderAmountAtomic,
        BigInt(signedPriceBpsForLock),
        BigInt(totalBps),
      ),
    [orderAmountAtomic, signedPriceBpsForLock, totalBps],
  );

  // P0-11 / QA #2 (cost-vs-face): insufficient-balance gate. BUY only (SELL
  // commits shares, not USDT — see `insufficientShares` below).
  //
  // Gate on `buyerLockAtomic` so this mirrors what the backend actually locks.
  // It must never sit BELOW the backend's lock, or an order passes here and is
  // rejected with "Insufficient balance" after the user has signed; and never
  // ABOVE it, or the CTA hard-disables on orders the backend would accept.
  //
  // This used to compare against `orderAmountAtomic` — the SHARE count, which
  // at $1 face IS the To-Win payout. That over-demanded by (1−price)×shares:
  // a $10 limit buy at 50¢ demanded $20, at 10¢ demanded $100. It mirrored the
  // backend correctly when written (the backend locked face too), then the
  // backend moved to cost+maxFee and this gate didn't follow. Keep them in
  // lockstep — if `buyerLock` changes, change this with it.
  const insufficientBalance =
    orderSide === 0 &&
    orderAmountAtomic > BigInt(0) &&
    isConnected &&
    !!balanceData &&
    availableUsdAtomic < buyerLockAtomic;
  const insufficientBalanceShortfallUsd = useMemo(() => {
    if (!insufficientBalance) return 0;
    const short = buyerLockAtomic - availableUsdAtomic;
    return Number(short) / 1_000_000;
  }, [insufficientBalance, buyerLockAtomic, availableUsdAtomic]);

  // SELL mirror of the balance gate: you can only sell shares you own.
  // `orderAmountAtomic` is the share count being sold; `ownedSharesAtomic` is
  // the live position for this market+side. Gating here disables the CTA
  // before signing, instead of letting the sign-step precheck throw after the
  // user has committed to the trade.
  const insufficientShares =
    orderSide === 1 &&
    orderAmountAtomic > BigInt(0) &&
    isConnected &&
    !!positionsData &&
    ownedSharesAtomic < orderAmountAtomic;

  // Fee mirrors the contract: base is the SHARE count (fillAmount), weighted
  // by 4·p·(1−p). Pass shares (in $ units) as the notional — NOT the budget.
  const { feeUsd: feeUsdDisplay, effectivePercentOfNotional } = estimateTotalFee(
    sharesPreview,
    totalBps,
    sharePriceBps,
    cfg?.feeModel,
  );
  const shareCentsLabel = formatShareCentsLabel(sharePriceBps);

  // PR-O follow-up: for MARKET orders, the SIGNED price is the worst-case
  // (slippage cap), not the expected fill. Surface that cap in the Details
  // accordion so the user can see what they're agreeing to before the
  // wallet popup. The on-chain Settlement uses this as cashPart, so the
  // user could pay up to this much per share. The actual fill typically
  // matches at `avgPriceUsd` (= VWAP) and the difference settles into
  // marketRetained as protocol dust.
  const worstCasePriceCents =
    marketSlippagePriceBps == null ? null : marketSlippagePriceBps / 100;
  const peakFeeBps = cfg?.peakFeeBps ?? totalBps;
  const peakFeePct = (peakFeeBps / 100).toFixed(2);

  // Polymarket-parity: To-win = shares × $1 (each winning share pays $1).
  // For BUY: net profit ≈ toWin − (actual spend) − fee, where the spend is
  // `notionalUsd` (price × shares), i.e. ≈ the budget — NOT the budget echoed
  // back, so the flooring of shares is reflected honestly.
  // For SELL (PR-5-bundle, formula (c)): the seller receives `price × shares`
  // cash atomically on-chain (clean price, no fee deduction). Fees come from
  // the buyer's residual, NOT the seller's proceeds.
  const toWinUsd = sharesPreview;
  const sellProceedsUsd = notionalUsd;
  const profitIfBuyWin = Math.max(0, toWinUsd - notionalUsd - feeUsdDisplay);

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

      // Session-key grant (PoC-validated 2026-07-06): fresh users get the
      // session installed inside the onboarding UserOp above (no extra
      // popup); already-onboarded SCAs get a one-time install UserOp here.
      // After this, order/cancel/WS signatures are popup-less. Non-fatal by
      // design: rejection or failure just keeps owner-key popup signing.
      if (ak && sessionOrdersEnabled() && !ak.hasOrderSession) {
        try {
          toast.info("Enabling 1-click trading… one-time setup, confirm in your wallet.");
          const grant = await ak.ensureOrderSession();
          if (grant === "installed") {
            toast.success("1-click trading enabled — orders no longer need a wallet confirmation.");
          }
        } catch (e) {
          console.warn("[TradeForm] session grant declined/failed — owner-key signing stays", e);
        }
      }

      // Bounds are on the user's INPUT — a $ BUDGET (BUY) or a SHARE count
      // (SELL), both in the $5–$500 window. This is NOT the wire `amount`.
      const inputAtomic = parseUsdtToAtomic(stakeUsd.toFixed(2));
      const min = parseUsdtToAtomic(String(MIN_STAKE_USDT));
      const max = parseUsdtToAtomic(String(MAX_STAKE_USDT));
      if (inputAtomic < min || inputAtomic > max) {
        throw new Error(`Amount must be $${MIN_STAKE_USDT}–$${MAX_STAKE_USDT}`);
      }

      if (orderType !== "MARKET" && userPriceCentsInput !== "") {
        const v = validateLimitPriceCents(userPriceCentsInput);
        if (v.bps == null) throw new Error(v.error ?? "Invalid price");
      }

      // ── Derive the wire `amount` (a SHARE count) + signed price ─────────
      // THE FIX: `Order.amount` is shares, and the contract charges
      // `price × amount / 10000`. A "spend $10" BUY must therefore convert the
      // budget to shares against the LIVE asks (else "$10" signs as 10 shares
      // and costs price×10/10000 = $5 at 50¢). Everything is computed off the
      // freshest book so a user who lingered doesn't sign a stale conversion.
      //
      // Adverse-slippage prompt (MARKET only): compare the VWAP shown at click
      // vs the fresh VWAP; 1¢ threshold, adverse-only.
      const maybePromptSlippage = (freshAvgBps: bigint) => {
        if (vwapResult?.avgPriceBps == null) return;
        const decision = slippageDecision(vwapResult.avgPriceBps, freshAvgBps, orderSide, BigInt(100));
        if (decision === "prompt") {
          const displayedC = (Number(vwapResult.avgPriceBps) / 100).toFixed(0);
          const currentC = (Number(freshAvgBps) / 100).toFixed(0);
          const ok = window.confirm(
            `Price moved from ${displayedC}¢ to ${currentC}¢. Continue at ${currentC}¢?`,
          );
          if (!ok) {
            throw new Error("Cancelled — price moved beyond your slippage tolerance.");
          }
        }
      };

      let amount: bigint;
      let priceNum: number;
      if (orderType === "MARKET") {
        // Force a fresh fetch — bypass React Query's 2s cache.
        const fresh = await qc.fetchQuery({
          queryKey: ["orderbook", marketKey.toLowerCase()],
          queryFn: () => getOrderbook(marketKey),
          staleTime: 0,
        });
        // Unify the fresh book so a MARKET BUY/SELL walks complementary liquidity
        // too (mint against DOWN bids / merge against DOWN asks). Off → raw side book.
        const freshUnified = unifyOrderBook(fresh, COMPLEMENTARY_MATCHING_ENABLED);
        const freshSideBook = side === 1 ? freshUnified.up : freshUnified.down;
        const freshLevels = orderSide === 0 ? freshSideBook.asks : freshSideBook.bids;
        const bestPriceBps = freshLevels.length > 0 ? Number(freshLevels[0].price) : null;
        const slipped = computeMarketSlippagePrice({ orderSide, bestPriceBps });
        if (slipped == null) throw new Error("Insufficient liquidity");
        priceNum = slipped;

        if (orderSide === 0 /* BUY: spend budget → shares */) {
          const walk = walkBookForBudget(freshLevels, inputAtomic);
          if (walk.avgPriceBps == null || walk.sharesAtomic <= BigInt(0)) {
            throw new Error("No matching liquidity at submit time. Try again or pick a different side.");
          }
          if (walk.requiresMoreDepth) {
            throw new Error(
              `Insufficient liquidity at submit time. Max fillable now: $${(Number(walk.spentAtomic) / 1_000_000).toFixed(2)}.`,
            );
          }
          amount = walk.sharesAtomic;
          maybePromptSlippage(walk.avgPriceBps);
        } else {
          /* SELL: sell `inputAtomic` shares; walk bids for VWAP + depth. */
          amount = inputAtomic;
          const walk = walkBookForAvgFillPrice(freshLevels, inputAtomic);
          if (walk.avgPriceBps == null) {
            throw new Error("No matching liquidity at submit time. Try again or pick a different side.");
          }
          if (walk.requiresMoreDepth) {
            throw new Error(
              `Insufficient liquidity at submit time. Max fillable now: $${(Number(walk.fillableAtomic) / 1_000_000).toFixed(2)}.`,
            );
          }
          maybePromptSlippage(walk.avgPriceBps);
        }
      } else {
        // LIMIT / POST_ONLY / IOC: sign at the user's limit price.
        //   BUY  → shares = budget ÷ limit (fills at ≤ limit → spend ≤ budget).
        //   SELL → the share count the user typed.
        priceNum = limitPrice;
        amount =
          orderSide === 0
            ? usdToShares(inputAtomic, BigInt(limitPrice))
            : inputAtomic;
      }
      if (amount <= BigInt(0)) {
        throw new Error("Order amount rounds to zero — increase the amount.");
      }

      if (orderSide === 1 /* SELL */) {
        try {
          const positions = await getPositions(smartAccount || address);
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
      //   "1h"    → now + 3600 (legacy default; kept for users who want it)
      //   "close" → market.endTime (default; expires at market close)
      // Always a future timestamp — see `expiryForMode`.
      const expiry = expiryForMode(expiryMode, market.endTime);
      const typeNum = ORDER_TYPE_U8[orderType];

      // `amount` (shares) and `priceNum` (the non-zero signed price — the
      // slippage cap for MARKET, the limit for others; price=0 would trip the
      // contract's FeeBreakdownInvalid) were both derived from the fresh book
      // above, so the signed digest reproduces the contract's cashPart math.

      // Account Kit: order maker is the user's SCA (a contract). Settlement's
      // `SignatureChecker.isValidSignatureNow` routes to
      // `SCA.isValidSignature(orderDigest, sig)` (ERC-1271/7739). The owner
      // key signs the FULL "UpDown Exchange" typed-data via the smart-wallet
      // client and the 6492 wrapper is stripped (`signTypedDataBare`) — no
      // WalletAuth wrap, no relayer meta-tx. `ensureSettlementAllowance`
      // above guarantees the SCA is deployed before this signature is used.
      const twAddress = smartAccount as `0x${string}`;
      if (!ak) throw new Error("Wallet not ready — finish sign-in first");
      // F-2026-17731 (Hacken remediation V2): sign a fee cap into the order. The relayer charges
      // a probability-weighted fee (4·p·(1−p), peak weight 1.0 at 50¢) computed at each fill's
      // price, and a taker order can fill across multiple price levels. The only cap that
      // provably bounds the CUMULATIVE fee for any fill distribution is the worst-case weight:
      // amount × totalFeeBps / 10000 (≥ Σ per-fill fees, since each fill's weight ≤ 1 and the
      // fills sum to ≤ amount). The contract enforces `platformFee + makerFee ≤ takerOrder.maxFee`
      // cumulatively, so signing the peak means legitimate fills never revert with
      // FeeExceedsTakerCap while still bounding the relayer to at most totalFeeBps of notional.
      // `totalBps` is the same constant the pre-sign `buyerLock` gate uses; the
      // amount here is the fresh-book one, so recompute rather than reuse.
      const maxFee = (amount * BigInt(totalBps)) / BigInt(10000);
      const msg = {
        maker: twAddress,
        market: parsedKey.marketId,
        option: BigInt(side),
        side: orderSide,
        type: typeNum,
        price: BigInt(priceNum),
        amount,
        maxFee,
        nonce: BigInt(nonce),
        expiry: BigInt(expiry),
      };

      // Sign against THIS market's settlement (parsedKey is non-null past the
      // guard above). The backend rebuilds the order domain from the market's
      // own settlement; on the single-settlement demo this equals
      // cfg.eip712.domain.verifyingContract, so the digest is unchanged there.
      const typed = buildOrderTypedData(cfg, msg, parsedKey.settlement);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signature = await ak.signTypedDataBare(typed as any);

      await postOrder({
        maker: twAddress,
        market: parsedKey.composite,
        option: side,
        side: orderSide,
        type: typeNum,
        // PR-O follow-up: ALWAYS the signed (non-zero) price; MARKET
        // orders carry their slippage-derived cap so the on-chain
        // Settlement reproduces the same cashPart math from the signed
        // payload.
        price: priceNum,
        amount: amount.toString(),
        // F-2026-17731: the signed fee cap, sent verbatim as the value baked into the order
        // digest above. Must equal `msg.maxFee` or the on-chain signature check would reject.
        maxFee: maxFee.toString(),
        nonce,
        expiry,
        signature,
      });
    },
    onSuccess: () => {
      toast.success("Order submitted");
      // Clear inputs so a post-fill positions/balance refetch can't trip the
      // insufficient-shares / insufficient-balance gates against a stale input.
      // A SELL leaves the sold share count in the box; once positions refetch to
      // the reduced holdings, that stale count trips `insufficientShares` and
      // paints a spurious red inline alert. Resetting here (the Max/Clear chips
      // and deep-link init set the input explicitly, so they still work).
      setStakeUsdInput("");
      setUserPriceCentsInput("");
      track("order_placed", {
        type: orderType,
        side: orderSide === 0 ? "BUY" : "SELL",
        option: side === 1 ? "UP" : "DOWN",
        pair: market?.pairSymbol ?? "unknown",
        amountUsd: stakeUsd,
        priceCents: orderType === "MARKET" ? null : limitPrice / 100,
      });
      // All identity-scoped caches are keyed by the SCA (the trading
      // identity the backend's `resolveOwnerEoa` rows are created under).
      const sa = smartAccount?.toLowerCase() ?? "";
      qc.invalidateQueries({ queryKey: ["positions", sa] });
      qc.invalidateQueries({ queryKey: ["balance", sa] });
      qc.invalidateQueries({ queryKey: ["orderbook", marketKey.toLowerCase()] });
      qc.invalidateQueries({ queryKey: ["orders", sa] });
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

  const activeOtype = ORDER_TYPES.find((t) => t.id === orderType) ?? ORDER_TYPES[0]!;

  // 2026-05-16 BUG A redesign — derived render values.
  //
  // Probability split bar: percent labels at the ends, fills proportional
  // to the orderbook-mid implied probability. Uses `upMidCents` /
  // `downMidCents` so the bar tracks the same source of truth as the
  // direction buttons. Falls back to 50/50 when the orderbook is empty
  // (matches existing button behavior).
  const upPct = Math.max(0, Math.min(100, Math.round(upMidCents)));
  const downPct = Math.max(0, Math.min(100, 100 - upPct));

  // Average price (in dollars) for the "To Win / Avg Price" primary
  // summary. Falls out of effective price (best ask for BUY, best bid
  // for SELL, limit price for non-MARKET).
  const avgPriceUsd = effectivePriceCents / 100;

  // Available-balance label for the "Amount" row. 6 decimals atomic →
  // USD dollars (parseFloat is fine — under $1B the precision is
  // preserved). Empty when balance hasn't loaded yet.
  const availableUsd = availableUsdAtomic > BigInt(0)
    ? Number(availableUsdAtomic) / 1_000_000
    : 0;

  // Owned shares in display units (1 share = $1 face) for the SELL-side
  // "Available N UP shares" label and Max chip.
  const ownedShares = Number(ownedSharesAtomic) / 1_000_000;

  // State-adaptive CTA descriptor. Single source of truth for both
  // label and the disabled flag — avoids drift between disabled state
  // and the tooltip string that the legacy CTA carried.
  //
  // States flow from "blocker first" so the most actionable label wins:
  //   - geoBlock → static label, disabled (region gate)
  //   - !isConnected → "Connect Wallet" (handled by WalletConnectorList
  //     panel below; CTA itself stays hidden)
  //   - !smartAccount → "Sign in" (waiting on ThinWallet provisioning)
  //   - insufficient balance → "Deposit" (links to Header deposit flow)
  //   - market terminal / no liquidity / insufficient depth / out of
  //     range → contextual disabled label (no tooltip; visible inline)
  //   - happy path → "Buy UP" / "Sell DOWN" tuned to side+orderSide
  //
  // The label is intentionally short so the CTA never wraps at 375px.
  type CtaDescriptor = {
    label: string;
    disabled: boolean;
    inlineError: string | null;
  };
  const cta: CtaDescriptor = (() => {
    if (!isConnected) {
      return { label: "Connect Wallet", disabled: true, inlineError: null };
    }
    if (geoBlocked) {
      return {
        label: "Not available in your region",
        disabled: true,
        inlineError: null,
      };
    }
    if (submit.isPending) {
      return { label: "Signing…", disabled: true, inlineError: null };
    }
    if (!isMarketTradeable) {
      return {
        label: "Market closing",
        disabled: true,
        inlineError: "This market is closing — pick the next live one.",
      };
    }
    if (!smartAccount) {
      return {
        label: "Sign in to trade",
        disabled: true,
        inlineError: null,
      };
    }
    if (priceInputInvalid) {
      return {
        label: "Fix limit price",
        disabled: true,
        inlineError: userPriceParsed.error ?? "Limit price must be 0.01¢–99.99¢.",
      };
    }
    if (stakeUsd <= 0) {
      const verb = orderSide === 0 ? "Buy" : "Sell";
      const dir = side === 1 ? "UP" : "DOWN";
      return { label: `${verb} ${dir}`, disabled: true, inlineError: null };
    }
    if (stakeOutOfRange) {
      return {
        label: "Adjust amount",
        disabled: true,
        inlineError: `Amount must be $${MIN_STAKE_USDT}–$${MAX_STAKE_USDT}.`,
      };
    }
    if (insufficientBalance) {
      return {
        label: "Deposit",
        disabled: true,
        inlineError: `You need $${insufficientBalanceShortfallUsd.toFixed(2)} more to place this trade.`,
      };
    }
    if (insufficientShares) {
      const dir = side === 1 ? "UP" : "DOWN";
      return {
        label: "Insufficient shares",
        disabled: true,
        inlineError:
          ownedShares > 0
            ? `You own ${ownedShares.toFixed(2)} ${dir} share${ownedShares === 1 ? "" : "s"} — reduce the amount.`
            : `You don't own any ${dir} shares on this market.`,
      };
    }
    if (noLiquidity) {
      return {
        label: "No liquidity",
        disabled: true,
        inlineError: `No ${side === 1 ? "UP" : "DOWN"} ${orderSide === 0 ? "asks" : "bids"} on the book — try a Limit order.`,
      };
    }
    if (insufficientDepth) {
      return {
        label: "Insufficient depth",
        disabled: true,
        inlineError: `Max $${insufficientDepthMaxUsd.toFixed(2)} fillable right now.`,
      };
    }
    const verb = orderSide === 0 ? "Buy" : "Sell";
    const dir = side === 1 ? "UP" : "DOWN";
    return {
      label: `${verb} ${dir} · $${stakeUsd.toFixed(2)}`,
      disabled: false,
      inlineError: null,
    };
  })();

  const ctaSideClass = side === 1 ? "pp-trade-v2__cta--up" : "pp-trade-v2__cta--down";
  // The "Deposit" branch routes the user to the Header deposit modal
  // via a CustomEvent the Header listens for. We don't open a modal
  // from inside TradeForm — single trade UI surface discipline —
  // and we don't route through hash anchors because the URL state
  // would persist across navigation. The event is fire-and-forget;
  // the Header's effect handler opens DepositModal on receipt.
  const handleCtaClick = () => {
    if (cta.disabled) {
      if (cta.label === "Deposit" && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("pp:open-deposit"));
      }
      return;
    }
    if (geoBlocked) return;
    if (address && !hasAcceptedCurrentVersion(address)) {
      setTermsModalOpen(true);
      return;
    }
    submit.mutate();
  };

  return (
    <div className="pp-panel pp-trade-v2">
      {/* Header row — section label + compact order-type pill. Short
          click toggles MARKET ↔ LIMIT; long-press / right-click opens
          the 4-item menu including POST_ONLY + IOC. */}
      <div className="pp-trade-v2__header">
        <span className="pp-trade-v2__heading">Trade</span>
        <div ref={otypeRef} className="pp-trade-v2__otype-wrap">
          <button
            type="button"
            className="pp-trade-v2__otype"
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
            <span className="pp-trade-v2__otype-caret">▾</span>
          </button>
          {otypeMenuOpen && (
            <div className="pp-trade-v2__otype-menu">
              {ORDER_TYPES.map((ot) => (
                <button
                  key={ot.id}
                  type="button"
                  className={cn(
                    "pp-trade-v2__otype-item",
                    orderType === ot.id && "pp-trade-v2__otype-item--on",
                  )}
                  onClick={() => {
                    setOrderType(ot.id);
                    setOtypeMenuOpen(false);
                  }}
                >
                  <span>{ot.label}</span>
                  {ot.hint && <span className="pp-trade-v2__otype-hint">{ot.hint}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Buy / Sell tabs — underline indicator, no pill background. */}
      <div className="pp-trade-v2__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={orderSide === 0}
          className={cn("pp-trade-v2__tab", orderSide === 0 && "pp-trade-v2__tab--on")}
          onClick={() => setOrderSide(0)}
        >
          Buy
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={orderSide === 1}
          className={cn("pp-trade-v2__tab", orderSide === 1 && "pp-trade-v2__tab--on")}
          onClick={() => setOrderSide(1)}
        >
          Sell
        </button>
      </div>

      {/* Probability split bar. Reads from orderbook-mid via upMidCents
          (same source as the direction buttons). Falls back to 50/50
          when book is empty so the visual never collapses to nothing. */}
      <div
        className="pp-trade-v2__probbar"
        role="img"
        aria-label={`Probability UP ${upPct}% / DOWN ${downPct}%`}
      >
        <span className="pp-trade-v2__probbar-label pp-trade-v2__probbar-label--up">
          {upPct}% UP
        </span>
        <div className="pp-trade-v2__probbar-track">
          <div
            className="pp-trade-v2__probbar-fill pp-trade-v2__probbar-fill--up"
            style={{ width: `${upPct}%` }}
          />
          <div
            className="pp-trade-v2__probbar-fill pp-trade-v2__probbar-fill--down"
            style={{ width: `${downPct}%` }}
          />
        </div>
        <span className="pp-trade-v2__probbar-label pp-trade-v2__probbar-label--down">
          {downPct}% DOWN
        </span>
      </div>

      {/* Direction selector — flat fills. Selected = solid full color;
          unselected = ghost outline with same-color text + arrow. No
          shine, no gradient, no animation. */}
      <div className="pp-trade-v2__direction">
        <button
          type="button"
          className={cn(
            "pp-trade-v2__direction-btn",
            "pp-trade-v2__direction-btn--up",
            side === 1 && "pp-trade-v2__direction-btn--on",
          )}
          aria-pressed={side === 1}
          title="Midpoint of the UP order book (implied probability) — a market buy executes at the book's ↑ ask price"
          onClick={() => {
            setSide(1);
            if (!isConnected) scrollToConnect();
          }}
        >
          <span>BUY UP</span>
          <span className="pp-trade-v2__direction-cents pp-tabular">
            {Math.round(upMidCents)}¢
          </span>
        </button>
        <button
          type="button"
          className={cn(
            "pp-trade-v2__direction-btn",
            "pp-trade-v2__direction-btn--down",
            side === 2 && "pp-trade-v2__direction-btn--on",
          )}
          aria-pressed={side === 2}
          title="Midpoint of the DOWN order book (implied probability) — a market buy executes at the book's ↑ ask price"
          onClick={() => {
            setSide(2);
            if (!isConnected) scrollToConnect();
          }}
        >
          <span>BUY DOWN</span>
          <span className="pp-trade-v2__direction-cents pp-tabular">
            {Math.round(downMidCents)}¢
          </span>
        </button>
      </div>

      {/* Limit price — only visible when order type rests on the book.
          Same ± steppers as before; restyled inputs only. */}
      {orderType !== "MARKET" && (
        <div className="pp-trade-v2__limit">
          <label className="pp-trade-v2__row-label" htmlFor="limit-price-cents">
            Limit price · cents
          </label>
          <div className="pp-trade-v2__limit-row">
            <button
              type="button"
              className="pp-trade-v2__stepper"
              onClick={() => setUserPriceCentsInput(stepPriceBps(limitPrice, -100))}
              aria-label="Decrease limit price by 1¢"
            >
              −
            </button>
            <input
              id="limit-price-cents"
              type="number"
              inputMode="decimal"
              min={0.01}
              max={99.99}
              step={0.01}
              value={userPriceCentsInput === "" ? autoCentsDisplay : userPriceCentsInput}
              onChange={(e) => setUserPriceCentsInput(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              className={cn(
                "pp-trade-v2__limit-input pp-tabular",
                priceInputInvalid && "pp-trade-v2__limit-input--error",
              )}
              aria-invalid={priceInputInvalid}
              aria-describedby="limit-price-hint"
            />
            <button
              type="button"
              className="pp-trade-v2__stepper"
              onClick={() => setUserPriceCentsInput(stepPriceBps(limitPrice, 100))}
              aria-label="Increase limit price by 1¢"
            >
              +
            </button>
            <span className="pp-trade-v2__limit-bps pp-tabular">{limitPrice} bps</span>
          </div>
          {priceInputInvalid && (
            <p id="limit-price-hint" className="pp-trade-v2__hint pp-trade-v2__hint--error">
              {userPriceParsed.error}
            </p>
          )}
          {/* Non-blocking hint: this LIMIT price doesn't cross the current
              executable price, so it will rest rather than fill now (QA
              round-5). Suppressed while the price input is invalid (the error
              hint above takes over) and when there's no book to compare. */}
          {!priceInputInvalid && nonCrossingHintBps != null && (
            <p className="pp-trade-v2__hint">
              {orderSide === 0 ? "Below" : "Above"} the current executable price (
              {formatBookPriceCents(nonCrossingHintBps)}¢) — your order will rest
              until the market reaches your price.
            </p>
          )}
        </div>
      )}

      {/* Amount row — Myriad pattern: label + tiny gray "Available $X"
          subtitle on the left, single big numeric input below the label
          row. Replaces the old "Stake (USD)" + inline-$ layout. */}
      <div className="pp-trade-v2__amount">
        <div className="pp-trade-v2__amount-label-row">
          <label className="pp-trade-v2__row-label" htmlFor="trade-stake">
            Amount
          </label>
          <span className="pp-trade-v2__amount-available pp-tabular">
            {orderSide === 1
              ? `Available ${ownedShares.toFixed(2)} ${side === 1 ? "UP" : "DOWN"} share${ownedShares === 1 ? "" : "s"}`
              : `Available $${availableUsd.toFixed(2)}`}
          </span>
        </div>
        <div className="pp-trade-v2__amount-input-wrap">
          {/* BUY takes a $ budget; SELL takes a SHARE count (1 share = $1
              face). The affordance must track that meaning — a `$` on the
              SELL input mislabels a share count as dollars. BUY shows a
              leading `$`; SELL shows a trailing "shares" unit instead. */}
          {orderSide === 0 && (
            <span className="pp-trade-v2__amount-currency" aria-hidden>
              $
            </span>
          )}
          <input
            id="trade-stake"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={stakeUsdInput}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9.]/g, "");
              const parts = raw.split(".");
              const cleaned = parts.length > 2
                ? `${parts[0]}.${parts.slice(1).join("")}`
                : raw;
              setStakeUsdInput(cleaned);
            }}
            onFocus={(e) => e.currentTarget.select()}
            className={cn(
              "pp-trade-v2__amount-input pp-tabular",
              stakeOutOfRange && "pp-trade-v2__amount-input--error",
            )}
            aria-invalid={stakeOutOfRange}
          />
          {orderSide === 1 && (
            <span className="pp-trade-v2__amount-currency" aria-hidden>
              shares
            </span>
          )}
        </div>
        <div className="pp-trade-v2__chips">
          {STAKE_QUICK_ADDS.map((qa, i) =>
            qa.kind === "max" ? (
              <button
                key="max"
                type="button"
                className="pp-trade-v2__chip"
                onClick={() => {
                  // SELL Max = the shares you actually own (1 share = $1 face),
                  // clamped to the trading window by maxStakeForBalance.
                  if (orderSide === 1) {
                    setStakeUsdInput(maxStakeForBalance(ownedSharesAtomic));
                    return;
                  }
                  // BUY collateral is the share count (over-locked as USDT by
                  // the backend). The most a budget can spend while keeping
                  // shares ≤ available is `available × price / 10000`; anything
                  // larger would over-lock and be rejected.
                  const base =
                    availableUsdAtomic > BigInt(0) ? availableUsdAtomic : MAX_STAKE_ATOMIC;
                  const budgetAtomic = (base * BigInt(sharePriceBps)) / BigInt(10000);
                  setStakeUsdInput(maxStakeForBalance(budgetAtomic));
                }}
                aria-label="Set amount to max"
              >
                Max
              </button>
            ) : (
              <button
                key={`add-${qa.usd}-${i}`}
                type="button"
                className="pp-trade-v2__chip"
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
            className="pp-trade-v2__chip pp-trade-v2__chip--ghost"
            onClick={() => setStakeUsdInput("")}
            aria-label="Clear amount"
          >
            Clear
          </button>
        </div>
        {/* Inline error replaces the To Win row when triggered. Always
            colored --down so the user sees it at a glance; tooltip-on-
            disabled-CTA pattern is gone. */}
        {cta.inlineError ? (
          <p className="pp-trade-v2__inline-error" role="alert">
            {cta.inlineError}
          </p>
        ) : null}
      </div>

      {/* Primary payoff — "To Win $X" + "Avg Price $0.XX". Replaces the
          5-line summary. Full breakdown lives behind the Details ▾
          accordion below so power users can still verify the math. */}
      {!cta.inlineError && (
        <div className="pp-trade-v2__payoff">
          <div className="pp-trade-v2__payoff-primary">
            <span
              className="pp-trade-v2__payoff-label"
              title={
                orderSide === 0 && orderType === "MARKET"
                  ? "Estimated from current book liquidity; actual fill price may differ."
                  : undefined
              }
            >
              {/* MARKET fills at a VWAP over live book depth, so the payoff is
                  an estimate; a LIMIT order's payoff is exact if it fills at the
                  typed price. Keep the "To Win" prefix intact either way. */}
              {orderSide === 0
                ? orderType === "MARKET"
                  ? "To Win (est.)"
                  : "To Win"
                : "Receive"}
            </span>
            <span
              className={cn(
                "pp-trade-v2__payoff-value pp-tabular",
                orderSide === 0 && "pp-trade-v2__payoff-value--win",
              )}
            >
              ${(orderSide === 0 ? toWinUsd : sellProceedsUsd).toFixed(2)}
            </span>
          </div>
          <div className="pp-trade-v2__payoff-secondary">
            <span className="pp-trade-v2__payoff-secondary-label">Avg. Price</span>
            <span className="pp-trade-v2__payoff-secondary-value pp-tabular">
              ${avgPriceUsd.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Details accordion — default closed. Holds the 4 sub-numbers
          (You spend / Shares acquired / Fee / Net profit) plus the DMM
          rebate row when applicable. All data preserved; just one click
          away. */}
      <details
        className="pp-trade-v2__details"
        open={detailsOpen}
        onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="pp-trade-v2__details-summary">Details</summary>
        <div className="pp-trade-v2__details-body">
          <div className="pp-trade-v2__details-row">
            <span>{orderSide === 0 ? "You spend" : "You receive"}</span>
            <span className="pp-tabular">
              ${notionalUsd.toFixed(2)}
            </span>
          </div>
          <div className="pp-trade-v2__details-row">
            <span>Shares acquired</span>
            <span className="pp-tabular">{sharesPreview.toFixed(2)}</span>
          </div>
          <div className="pp-trade-v2__details-row">
            <span>
              {orderSide === 0 ? "Fee" : "Buyer pays fee"}
              <InfoTip
                text={`Peak ${peakFeePct}% at 50¢. Probability-weighted, tapers at extremes.`}
              />
            </span>
            <span className="pp-tabular">
              ${feeUsdDisplay.toFixed(2)} ({effectivePercentOfNotional.toFixed(2)}% at {shareCentsLabel})
            </span>
          </div>
          {orderSide === 0 ? (
            <div className="pp-trade-v2__details-row">
              <span>Net profit if {side === 1 ? "Up" : "Down"} wins</span>
              <span className="pp-tabular pp-up">+${profitIfBuyWin.toFixed(2)}</span>
            </div>
          ) : null}
          {worstCasePriceCents != null ? (
            <div className="pp-trade-v2__details-row">
              <span>
                Max price{" "}
                <InfoTip
                  text={`5% slippage cap. Market orders sign at this worst-case price so the trade can't fill above it. Typical fill is at "Avg. Price" above; any difference goes to the protocol pool.`}
                />
              </span>
              <span className="pp-tabular">≤ ${worstCasePriceCents.toFixed(2)}</span>
            </div>
          ) : null}
        </div>
      </details>

      {/* CTA — flat solid fill matching selected side. No shine, no
          gradient. State-adaptive label drives both visible text and
          (separately) the disabled state. */}
      {isConnected ? (
        <button
          type="button"
          disabled={cta.disabled}
          className={cn("pp-trade-v2__cta", ctaSideClass, cta.disabled && "pp-trade-v2__cta--disabled")}
          onClick={handleCtaClick}
        >
          {cta.label}
        </button>
      ) : null}

      {/* Tiny gray terms link — Myriad pattern. Always rendered (auxiliary
          surface to the gating modal that fires on first-trade). */}
      {isConnected && (
        <p className="pp-trade-v2__terms-link">
          By trading you accept the{" "}
          <Link href="/docs/terms" className="pp-trade-v2__terms-link-anchor">
            Terms
          </Link>
          .
        </p>
      )}

      {/* Expires — secondary, BELOW the CTA. Only rendered when the
          order type makes expiry meaningful (LIMIT / POST_ONLY / IOC).
          MARKET orders fill on submit so the control is hidden. */}
      {orderType !== "MARKET" && (
        <div className="pp-trade-v2__expires">
          <span className="pp-trade-v2__row-label">Expires</span>
          <div className="pp-trade-v2__expires-row">
            {EXPIRY_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={cn(
                  "pp-trade-v2__expires-btn",
                  expiryMode === m.id && "pp-trade-v2__expires-btn--on",
                )}
                onClick={() => setExpiryMode(m.id)}
                title={m.hint}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* F3 (2026-05-16): inline mint CTA at the friction point.
          Renders when: connected + FAUCET_ENABLED (testnet or demo) +
          smartAccount provisioned + balance is insufficient for the current
          stake. Single click mints 100 to the SCA; toast confirms broadcast.
          Backend route is env-gated (404 in production) and rate-limited
          (1/addr/5min). */}
      {isConnected && FAUCET_ENABLED && insufficientBalance && smartAccount && (
        <button
          type="button"
          className="pp-trade-v2__testnet-mint"
          disabled={mintingTestUsdt}
          data-testid="tradeform-mint-test-usdtm"
          onClick={async () => {
            setMintingTestUsdt(true);
            try {
              const result = await postDevmintUsdt({
                address: smartAccount as `0x${string}`,
                amount: "100000000", // 100 USDTM atomic
              });
              toast.success(
                `Minted 100 ${tokenSymbolForChain} — tx ${result.txHash.slice(0, 10)}…`,
              );
            } catch (e) {
              toast.error(formatUserFacingError(e));
            } finally {
              setMintingTestUsdt(false);
            }
          }}
        >
          {mintingTestUsdt ? "Minting…" : `Get 100 ${tokenSymbolForChain} (${FAUCET_LABEL_SUFFIX})`}
        </button>
      )}

      {!isConnected && (
        <div ref={connectSectionRef} className="pp-trade-v2__connect">
          <p className="pp-trade-v2__connect-title">Connect wallet to trade</p>
          <p className="pp-trade-v2__connect-body">
            Choose a wallet. Side and size can be adjusted before signing.
          </p>
          <WalletConnectorList className="pp-trade-v2__connect-list" />
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

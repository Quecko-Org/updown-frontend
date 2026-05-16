"use client";

import { Menu, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { getBalance, getDmmStatus, getOrders } from "@/lib/api";
import { identifyHashed, resetIdentity, track } from "@/lib/analytics";
import { geoStateAtom, userSmartAccount } from "@/store/atoms";
import { formatUsdt } from "@/lib/format";
import { DepositModal } from "./DepositModal";
import { WithdrawModal } from "./WithdrawModal";
import { SignModal } from "./SignModal";
import { StatusIndicator } from "./StatusIndicator";
import { NotificationBell } from "./NotificationBell";
import { useWalletContext } from "@/context/WalletContext";
import { WalletConnectorList } from "@/components/WalletConnectorList";
import { getFormattedAddress } from "@/utils/walletHelpers";
import { cn } from "@/lib/cn";
import { getRestoredMarketsHref } from "@/hooks/useLastMarketView";

// Phase2-A: collapsed Positions + History into a single "Portfolio" surface
// with tabs (Active / Resolved). Old /positions and /history routes redirect
// into the right tab so any external link / bookmark continues working.
//
// PR-4 nav refactor (Meir 2026-05-13):
//   - /markets entry removed — the homepage IS the markets surface, the
//     duplicate link is noise.
//   - /portfolio is gated on `isWalletConnected` (disconnected users have
//     no positions; the link is a dead end pre-connect).
//   - /how-it-works is always visible — first-run entry point.
//   - /docs stays in the top bar but is `requireDesktop: true`, so the
//     mobile hamburger surfaces it via SECONDARY_NAV's inclusion. Same
//     priority-hide ladder as PR-1's mobile hamburger discipline.
//
// `requireConnected` + `requireDesktop` are filtered at render-time. Items
// without either flag are unconditional.
type NavItem = {
  href: string;
  label: string;
  requireConnected?: boolean;
  requireDesktop?: boolean;
};

const NAV: NavItem[] = [
  { href: "/portfolio", label: "Portfolio", requireConnected: true },
  { href: "/how-it-works", label: "How it works" },
  { href: "/docs", label: "Docs", requireDesktop: true },
];

// Secondary nav opens from the hamburger. Visible on all viewport sizes so
// /fees, /risk, /faq, /contact, /terms, /privacy stay one click away
// regardless of whether the top bar is showing primary nav (≥sm) or hiding
// it (<sm — the dropdown supplies primary nav too in that case).
const SECONDARY_NAV = [
  { href: "/settings", label: "Settings" },
  { href: "/faq", label: "FAQ" },
  { href: "/fees", label: "Fees" },
  { href: "/risk", label: "Risk disclosures" },
  { href: "/contact", label: "Contact" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
];

export function Header() {
  const pathname = usePathname();
  const {
    isWalletConnected,
    isLoading,
    loadingStep,
    walletAddress,
    disconnectWallet,
    showSignModal,
    handleSign,
    closeSignModal,
  } = useWalletContext();

  const smartAccount = useAtomValue(userSmartAccount);
  const geo = useAtomValue(geoStateAtom);

  // Track connect-success once per session per wallet — `wagmi` flips
  // `isWalletConnected` after the user picks a connector and signs in.
  // Reset PostHog identity on disconnect so a subsequent visitor on the
  // same browser doesn't inherit the previous wallet's events.
  useEffect(() => {
    if (isWalletConnected && walletAddress) {
      track("connect_wallet_succeeded");
      void identifyHashed(walletAddress);
    } else {
      resetIdentity();
    }
  }, [isWalletConnected, walletAddress]);
  /** Defense-in-depth: even if the overlay element is removed via
   *  DevTools, this flag short-circuits the connect dropdown so a
   *  restricted visitor still can't initiate the wallet flow. */
  const geoBlocked = geo.status === "restricted";

  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const connectRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Outside-click dismiss: only attach the listener while the corresponding
  // popover is open, and listen for `mousedown` instead of `click`.
  // The previous "always-on click + stopPropagation" pattern was fragile —
  // some real-mouse click sequences (mousedown → focus → mouseup → click)
  // closed the menu the same instant they opened it. Mousedown fires before
  // the toggle button's click handler; when the menu is closed, the listener
  // is unmounted, so the opening click cannot self-close. Same pattern is
  // used elsewhere (TradeForm.otypeMenu) and is the React idiom here.
  useEffect(() => {
    if (!connectOpen) return;
    function onDoc(e: MouseEvent) {
      if (connectRef.current && !connectRef.current.contains(e.target as Node)) {
        setConnectOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [connectOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  // Phase 4 PR-A (2026-05-16): trading-identity queries route through the
  // ThinWallet, not the EOA. Balance, orders, DMM rebate eligibility all
  // accrue to `order.maker` which under Phase 4 is the TW. Pre-fix these
  // queries returned 0 / empty because they were keyed by EOA, which had
  // never been the maker on any fill. Path-1 fallback (chain w/o factory):
  // smartAccount atom is set to EOA so this still resolves.
  const tradingIdentity = smartAccount || walletAddress;

  const { data: bal } = useQuery({
    queryKey: ["balance", tradingIdentity?.toLowerCase() ?? ""],
    queryFn: () => getBalance(tradingIdentity!),
    enabled: !!tradingIdentity && isWalletConnected,
    refetchInterval: 15_000,
    retry: 1,
  });

  const { data: dmmStatus } = useQuery({
    queryKey: ["dmmStatus", tradingIdentity?.toLowerCase() ?? ""],
    queryFn: () => getDmmStatus(tradingIdentity!),
    enabled: !!tradingIdentity && isWalletConnected,
    staleTime: 60_000,
  });

  // Phase2-PRE2: "in orders" derives from the open-orders list, NOT from
  // backend `balance.inOrders`. Two reasons:
  //   1. Backend SmartAccount.inOrders has a slow-leak class of bug — over
  //      time, lock decrements miss some fill paths and the counter drifts
  //      higher than the actual sum of locked-by-open-orders. (Verified
  //      against dev: a wallet with 0 open orders had $40 stuck in
  //      backend.inOrders.) Backend reconciliation is on the backlog.
  //   2. Single source of truth for "user's open orders". Header and
  //      /portfolio Active tab now read from the same `["orders", eoa]`
  //      query key, so they cannot disagree.
  // Result: the dropdown's "In orders" cell = sum(amount - filledAmount)
  // across orders the same query Portfolio renders.
  const { data: ordersResp } = useQuery({
    queryKey: ["orders", tradingIdentity?.toLowerCase() ?? ""],
    queryFn: () => getOrders(tradingIdentity!, { limit: 50 }),
    enabled: !!tradingIdentity && isWalletConnected,
    staleTime: 5_000,
    retry: 1,
  });

  const inOrdersDerived = useMemo<string>(() => {
    const orders = ordersResp?.orders ?? [];
    let sum = BigInt(0);
    for (const o of orders) {
      if (o.status === "OPEN" || o.status === "PARTIALLY_FILLED") {
        try {
          sum += BigInt(o.amount) - BigInt(o.filledAmount);
        } catch {
          /* skip malformed */
        }
      }
    }
    return sum.toString();
  }, [ordersResp]);

  // "Available" = on-chain USDT − sum(open-order remaining). Same desync class
  // as inOrders — backend's `available` is `cachedBalance - balance.inOrders`,
  // which inherits the leak. Recompute from `cachedBalance` (on-chain truth)
  // minus the derived in-orders.
  const availableDerived = useMemo<string>(() => {
    try {
      const cached = BigInt(bal?.cachedBalance ?? "0");
      const inOrd = BigInt(inOrdersDerived);
      const av = cached > inOrd ? cached - inOrd : BigInt(0);
      return av.toString();
    } catch {
      return bal?.available ?? "0";
    }
  }, [bal?.cachedBalance, bal?.available, inOrdersDerived]);

  // Phase 4: USDTM lives on the user's ThinWallet. Deposit + Withdraw UI
  // target the TW so the user funds/empties the contract that Settlement
  // pulls from at fill time. `tradingIdentity` (above) is the same atom
  // sourced this way and used for balance + orders queries.
  const depositAddress = tradingIdentity;

  function navActive(href: string): boolean {
    if (href === "/") return pathname === "/" || pathname.startsWith("/market/");
    // /docs has subpages (/docs/api, /docs/sdk) — match the prefix so the
    // top-nav highlight follows the user across tabs.
    if (href === "/docs") return pathname === "/docs" || pathname.startsWith("/docs/");
    return pathname === href;
  }

  return (
    <>
      {/* Full-screen loading overlay */}
      {isLoading && (
        <div
          className="fixed inset-0 flex flex-col items-center justify-center gap-3"
          style={{
            zIndex: "var(--z-drawer)",
            background: "oklch(14% 0.01 250 / 0.82)",
            backdropFilter: "blur(4px)",
          }}
        >
          <span className="pp-spin h-8 w-8" />
          {loadingStep && (
            <p className="max-w-xs text-center text-sm font-medium text-foreground">{loadingStep}</p>
          )}
        </div>
      )}

      <SignModal open={showSignModal} onSign={() => void handleSign()} onCancel={closeSignModal} />

      <header className="pp-hdr">
        <div className="pp-hdr__inner">
          {/* pr-fix-3 (2026-05-16): back button moved OUT of the header to a
              dedicated SubNav bar below. The previous in-header placement
              broke the 3-column grid on every sub-page (4 children
              overflowed to row 2). SubNav is sticky directly below this
              header. */}
          {/* Brand — SVG wordmark (mark + "PulsePairs" text baked into the SVG).
              On non-/ routes the logo also restores the last market view; on /
              it points home for accessibility. */}
          <Link
            href={pathname === "/" ? "/" : getRestoredMarketsHref()}
            className="pp-hdr__brand"
            aria-label="PulsePairs — markets"
          >
            {/* Wordmark: 34px desktop, 28px mobile. Native SVG aspect ratio
                (220×40 viewBox ≈ 5.5:1) preserved via w-auto. */}
            <Image
              src="/logo/pulsepairs-wordmark-dark.svg"
              alt="PulsePairs"
              width={187}
              height={34}
              priority
              className="block h-7 w-auto sm:h-[34px]"
            />
          </Link>

          {/* Desktop nav */}
          <nav className="pp-hdr__nav hidden sm:flex">
            {NAV.filter((n) => !n.requireConnected || isWalletConnected).map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "pp-hdr__navlink",
                  navActive(n.href) && "pp-hdr__navlink--on",
                  // requireDesktop items hide at <md so primary nav stays
                  // tight on tablets. The mobile hamburger surfaces them
                  // through SECONDARY_NAV (Docs is already in there).
                  n.requireDesktop && "hidden md:inline-flex",
                )}
              >
                {n.label}
              </Link>
            ))}
            {isWalletConnected && dmmStatus?.isDmm ? (
              <Link
                href="/rebates"
                className={cn("pp-hdr__navlink", pathname === "/rebates" && "pp-hdr__navlink--on")}
              >
                Rebates
              </Link>
            ) : null}
          </nav>

          {/* Right: balance + actions */}
          <div className="pp-hdr__right">
            <StatusIndicator />
            <NotificationBell />
            {isWalletConnected && walletAddress && (
              <>
                {/* Balance + address chip — hover for in-orders / total breakdown. */}
                <div className="group relative hidden sm:block">
                  <span
                    className="pp-walletchip"
                    aria-describedby="balance-breakdown"
                    data-pp-tw-address={tradingIdentity ?? ""}
                  >
                    <span className="pp-walletchip__dot" />
                    <span className="pp-walletchip__bal">${formatUsdt(availableDerived)}</span>
                    <span className="pp-walletchip__sep" />
                    <span className="pp-walletchip__addr">{getFormattedAddress(tradingIdentity ?? "")}</span>
                  </span>
                  <div
                    id="balance-breakdown"
                    role="tooltip"
                    className="pointer-events-none absolute right-0 top-full mt-2 hidden min-w-[220px] group-hover:block"
                    style={{ zIndex: "var(--z-chrome)" }}
                  >
                    <div
                      className="rounded-[var(--r-lg)] border p-3"
                      style={{
                        background: "var(--bg-1)",
                        borderColor: "var(--border-0)",
                        boxShadow: "var(--shadow-popover)",
                      }}
                    >
                      <dl className="space-y-1.5 text-xs">
                        <div className="flex items-baseline justify-between gap-4">
                          <dt style={{ color: "var(--fg-2)" }}>Available</dt>
                          <dd className="pp-tabular" style={{ color: "var(--fg-0)", fontWeight: 500 }}>
                            ${formatUsdt(availableDerived)}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-4">
                          <dt style={{ color: "var(--fg-2)" }}>In orders</dt>
                          <dd className="pp-tabular" style={{ color: "var(--fg-0)" }}>
                            ${formatUsdt(inOrdersDerived)}
                          </dd>
                        </div>
                        <div
                          className="flex items-baseline justify-between gap-4 pt-1.5"
                          style={{ borderTop: "1px solid var(--border-0)" }}
                        >
                          <dt style={{ color: "var(--fg-0)", fontWeight: 600 }}>Total</dt>
                          <dd className="pp-tabular" style={{ color: "var(--fg-0)", fontWeight: 500 }}>
                            ${formatUsdt(bal?.cachedBalance ?? "0")}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="pp-shiny-cta"
                  onClick={() => setDepositOpen(true)}
                  disabled={!depositAddress}
                >
                  Deposit
                </button>
                {/* pr-fix-3 (2026-05-16): Withdraw + Disconnect removed
                    from the top bar — both already exist in the hamburger
                    menu. Top bar at every viewport: [Deposit] [☰]. */}
              </>
            )}

            {!isWalletConnected && (
              <div className="relative" ref={connectRef}>
                <button
                  type="button"
                  className="pp-shiny-cta"
                  disabled={isLoading || geoBlocked}
                  title={geoBlocked ? "Not available in your region" : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (geoBlocked) return;
                    track("connect_wallet_attempted");
                    setConnectOpen((o) => !o);
                  }}
                >
                  {isLoading ? "Connecting…" : "Connect wallet"}
                </button>
                {connectOpen && !geoBlocked && (
                  <div
                    className="absolute right-0 top-full mt-2 min-w-[220px] rounded-[var(--r-lg)] border py-1"
                    style={{
                      zIndex: "var(--z-chrome)",
                      background: "var(--bg-1)",
                      borderColor: "var(--border-0)",
                      boxShadow: "var(--shadow-overlay)",
                    }}
                  >
                    <WalletConnectorList onPick={() => setConnectOpen(false)} buttonClassName="block" />
                  </div>
                )}
              </div>
            )}

            {/* Hamburger menu — visible on all viewports.
                Wrapper carries `position: relative` so the absolutely-
                positioned dropdown anchors to it. Clicks outside close via
                the document-level handler in useEffect above. */}
            <div ref={menuRef} className="relative ml-1">
              <button
                type="button"
                className="pp-btn pp-btn--ghost pp-btn--sm"
                onClick={() => setMenuOpen((o) => !o)}
                aria-label={menuOpen ? "Close menu" : "Menu"}
                aria-expanded={menuOpen}
              >
                {menuOpen ? (
                  <X size={18} strokeWidth={1.5} />
                ) : (
                  <Menu size={18} strokeWidth={1.5} />
                )}
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-2 min-w-[220px] rounded-[var(--r-lg)] border py-1"
                  style={{
                    zIndex: "var(--z-chrome)",
                    background: "var(--bg-1)",
                    borderColor: "var(--border-0)",
                    boxShadow: "var(--shadow-overlay)",
                  }}
                >
                  {/* Primary nav — only when the top bar hides it on small
                      viewports. Keeps the dropdown lean on desktop since
                      Markets / Portfolio / How it works already render up
                      top there. */}
                  <div className="sm:hidden">
                    {NAV.filter((n) => !n.requireConnected || isWalletConnected).map((n) => (
                      <Link
                        key={n.href}
                        href={n.href}
                        onClick={() => setMenuOpen(false)}
                        className={cn(
                          "pp-menu__item",
                          navActive(n.href) && "pp-menu__item--on",
                        )}
                        role="menuitem"
                      >
                        {n.label}
                      </Link>
                    ))}
                    {isWalletConnected && dmmStatus?.isDmm ? (
                      <Link
                        href="/rebates"
                        onClick={() => setMenuOpen(false)}
                        className={cn(
                          "pp-menu__item",
                          pathname === "/rebates" && "pp-menu__item--on",
                        )}
                        role="menuitem"
                      >
                        Rebates
                      </Link>
                    ) : null}
                    <div className="pp-menu__divider" />
                  </div>

                  {/* Secondary nav — always visible. /fees, /risk, /faq,
                      /contact, /terms, /privacy. Stays one click away
                      regardless of viewport. */}
                  {SECONDARY_NAV.map((n) => (
                    <Link
                      key={n.href}
                      href={n.href}
                      onClick={() => setMenuOpen(false)}
                      className={cn(
                        "pp-menu__item",
                        pathname === n.href && "pp-menu__item--on",
                      )}
                      role="menuitem"
                    >
                      {n.label}
                    </Link>
                  ))}

                  {/* Wallet actions — only when top bar hides them
                      (<sm). Desktop already has Withdraw / Disconnect
                      buttons in the right cluster. */}
                  {isWalletConnected && walletAddress && (
                    <div className="sm:hidden">
                      <div className="pp-menu__divider" />
                      <button
                        type="button"
                        className="pp-menu__item"
                        onClick={() => {
                          setWithdrawOpen(true);
                          setMenuOpen(false);
                        }}
                        role="menuitem"
                      >
                        Withdraw
                      </button>
                      <button
                        type="button"
                        className="pp-menu__item"
                        onClick={() => {
                          void disconnectWallet();
                          setMenuOpen(false);
                        }}
                        role="menuitem"
                      >
                        Disconnect
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} depositAddress={depositAddress ?? ""} />
      <WithdrawModal open={withdrawOpen} onClose={() => setWithdrawOpen(false)} />
    </>
  );
}

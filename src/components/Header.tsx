"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { getBalance, getDmmStatus } from "@/lib/api";
import { sessionReadyAtom, sessionRestoreFailedAtom, userSmartAccount } from "@/store/atoms";
import { formatUsdt } from "@/lib/format";
import { DepositModal } from "./DepositModal";
import { WithdrawModal } from "./WithdrawModal";
import { SignModal } from "./SignModal";
import { useWalletContext } from "@/context/WalletContext";
import { WalletConnectorList } from "@/components/WalletConnectorList";
import { getFormattedAddress } from "@/utils/walletHelpers";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/", label: "Markets" },
  { href: "/positions", label: "Positions" },
  { href: "/history", label: "History" },
  { href: "/fees", label: "Fees" },
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
    reauthorizeSession,
  } = useWalletContext();

  const smartAccount = useAtomValue(userSmartAccount);
  const sessionReady = useAtomValue(sessionReadyAtom);
  const sessionRestoreFailed = useAtomValue(sessionRestoreFailedAtom);

  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const connectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (connectRef.current && !connectRef.current.contains(e.target as Node)) {
        setConnectOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const { data: bal } = useQuery({
    queryKey: ["balance", walletAddress?.toLowerCase() ?? ""],
    queryFn: () => getBalance(walletAddress!),
    enabled: !!walletAddress && isWalletConnected && sessionReady,
    refetchInterval: 15_000,
    retry: 1,
  });

  const { data: dmmStatus } = useQuery({
    queryKey: ["dmmStatus", walletAddress?.toLowerCase() ?? ""],
    queryFn: () => getDmmStatus(walletAddress!),
    enabled: !!walletAddress && isWalletConnected,
    staleTime: 60_000,
  });

  const depositAddress = smartAccount;

  function navActive(href: string): boolean {
    if (href === "/") return pathname === "/" || pathname.startsWith("/market/");
    return pathname === href;
  }

  return (
    <>
      {/* Full-screen loading overlay */}
      {isLoading && (
        <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-white/80 backdrop-blur-sm">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          {loadingStep && (
            <p className="max-w-xs text-center text-sm font-medium text-foreground">{loadingStep}</p>
          )}
        </div>
      )}

      <SignModal open={showSignModal} onSign={() => void handleSign()} onCancel={closeSignModal} />

      <header className="sticky top-0 z-40 border-b border-border bg-white/95 shadow-card backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          {/* Logo */}
          <Link
            href="/"
            className="font-display text-xl font-bold tracking-tight text-brand transition-opacity hover:opacity-90"
          >
            PulsePairs
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 sm:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "rounded-[12px] px-3 py-2 text-sm font-medium transition-colors",
                  navActive(n.href)
                    ? "bg-brand-subtle text-brand"
                    : "text-foreground hover:bg-surface-muted hover:text-brand",
                )}
              >
                {n.label}
              </Link>
            ))}
            {isWalletConnected && dmmStatus?.isDmm ? (
              <Link
                href="/rebates"
                className={cn(
                  "rounded-[12px] px-3 py-2 text-sm font-medium transition-colors",
                  pathname === "/rebates"
                    ? "bg-brand-subtle text-brand"
                    : "text-foreground hover:bg-surface-muted hover:text-brand",
                )}
              >
                Rebates
              </Link>
            ) : null}
          </nav>

          {/* Right side: balance + actions */}
          <div className="flex items-center gap-2">
            {isWalletConnected && walletAddress && (
              <>
                {/* Balance chip */}
                <div className="hidden items-center gap-2 sm:flex">
                  <span className="rounded-[12px] border border-border bg-surface-muted px-3 py-1.5 font-mono text-sm font-semibold tabular-nums text-foreground">
                    ${formatUsdt(bal?.available ?? "0")}
                  </span>
                  <span className="rounded-[12px] border border-border bg-white px-3 py-1.5 font-mono text-xs text-muted">
                    {getFormattedAddress(walletAddress)}
                  </span>
                </div>
                {/* Action buttons */}
                <button
                  type="button"
                  className="rounded-[12px] bg-brand px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  onClick={() => setDepositOpen(true)}
                  disabled={!depositAddress}
                >
                  Deposit
                </button>
                <button
                  type="button"
                  className="hidden rounded-[12px] border border-border bg-white px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface-muted sm:inline-flex"
                  onClick={() => setWithdrawOpen(true)}
                >
                  Withdraw
                </button>
                {smartAccount && !sessionReady ? (
                  <button
                    type="button"
                    className={cn(
                      "hidden rounded-[12px] px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 sm:inline-flex",
                      sessionRestoreFailed
                        ? "animate-pulse border-2 border-down bg-down/10 text-down hover:bg-down/20"
                        : "border border-brand bg-brand-subtle text-brand hover:opacity-90",
                    )}
                    disabled={isLoading}
                    onClick={() => void reauthorizeSession()}
                  >
                    {sessionRestoreFailed ? "⚠ Re-authorize" : "Re-authorize"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="hidden rounded-[12px] border border-border px-3 py-2 text-sm font-medium text-muted transition-colors hover:border-brand hover:text-brand sm:inline-flex"
                  onClick={() => void disconnectWallet()}
                >
                  Disconnect
                </button>
              </>
            )}

            {!isWalletConnected && (
              <div className="relative" ref={connectRef}>
                <button
                  type="button"
                  className="rounded-[12px] bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  disabled={isLoading}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConnectOpen((o) => !o);
                  }}
                >
                  {isLoading ? "Connecting…" : "Connect wallet"}
                </button>
                {connectOpen && (
                  <div className="absolute right-0 top-full z-50 mt-2 min-w-[220px] rounded-[12px] border border-border bg-white py-1 shadow-card-hover">
                    <WalletConnectorList
                      onPick={() => setConnectOpen(false)}
                      buttonClassName="block"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Mobile hamburger */}
            <button
              type="button"
              className="ml-1 rounded-[12px] p-2 text-foreground transition-colors hover:bg-surface-muted sm:hidden"
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label="Menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {mobileMenuOpen ? (
                  <>
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </>
                ) : (
                  <>
                    <path d="M4 6h16" />
                    <path d="M4 12h16" />
                    <path d="M4 18h16" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="border-t border-border bg-white px-4 pb-4 pt-2 sm:hidden">
            <nav className="flex flex-col gap-1">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "rounded-[12px] px-3 py-2.5 text-sm font-medium transition-colors",
                    navActive(n.href)
                      ? "bg-brand-subtle text-brand"
                      : "text-foreground hover:bg-surface-muted",
                  )}
                >
                  {n.label}
                </Link>
              ))}
              {isWalletConnected && dmmStatus?.isDmm ? (
                <Link
                  href="/rebates"
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "rounded-[12px] px-3 py-2.5 text-sm font-medium transition-colors",
                    pathname === "/rebates"
                      ? "bg-brand-subtle text-brand"
                      : "text-foreground hover:bg-surface-muted",
                  )}
                >
                  Rebates
                </Link>
              ) : null}
            </nav>
            {isWalletConnected && walletAddress && (
              <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted">{getFormattedAddress(walletAddress)}</span>
                  <span className="font-mono text-sm font-semibold text-foreground">
                    ${formatUsdt(bal?.available ?? "0")}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="flex-1 rounded-[12px] border border-border bg-white py-2 text-sm font-semibold text-foreground"
                    onClick={() => { setWithdrawOpen(true); setMobileMenuOpen(false); }}
                  >
                    Withdraw
                  </button>
                  {smartAccount && !sessionReady ? (
                    <button
                      type="button"
                      className={cn(
                        "flex-1 rounded-[12px] py-2 text-sm font-semibold disabled:opacity-50",
                        sessionRestoreFailed
                          ? "animate-pulse border-2 border-down bg-down/10 text-down"
                          : "border border-brand bg-brand-subtle text-brand",
                      )}
                      disabled={isLoading}
                      onClick={() => {
                        void reauthorizeSession();
                        setMobileMenuOpen(false);
                      }}
                    >
                      {sessionRestoreFailed ? "⚠ Re-authorize" : "Re-authorize"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="flex-1 rounded-[12px] border border-border py-2 text-sm font-medium text-muted"
                    onClick={() => { void disconnectWallet(); setMobileMenuOpen(false); }}
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} depositAddress={depositAddress} />
      <WithdrawModal open={withdrawOpen} onClose={() => setWithdrawOpen(false)} />
    </>
  );
}

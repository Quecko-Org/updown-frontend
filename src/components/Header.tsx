"use client";

import { Menu, X } from "lucide-react";
import Image from "next/image";
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

  // Path-1 architecture: USDT lives on the EOA. Deposit/withdraw target the
  // connected wallet address directly. The SA address is kept in state for
  // legacy reasons (some atoms reference it) but is no longer the trading
  // custodian.
  const depositAddress = walletAddress;

  function navActive(href: string): boolean {
    if (href === "/") return pathname === "/" || pathname.startsWith("/market/");
    return pathname === href;
  }

  return (
    <>
      {/* Full-screen loading overlay */}
      {isLoading && (
        <div
          className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3"
          style={{ background: "oklch(14% 0.01 250 / 0.82)", backdropFilter: "blur(4px)" }}
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
          {/* Brand — SVG wordmark (mark + "PulsePairs" text baked into the SVG) */}
          <Link href="/" className="pp-hdr__brand" aria-label="PulsePairs — markets">
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
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn("pp-hdr__navlink", navActive(n.href) && "pp-hdr__navlink--on")}
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
            {isWalletConnected && walletAddress && (
              <>
                {/* Balance + address chip — hover for in-orders / total breakdown. */}
                <div className="group relative hidden sm:block">
                  <span className="pp-walletchip" aria-describedby="balance-breakdown">
                    <span className="pp-walletchip__dot" />
                    <span className="pp-walletchip__bal">${formatUsdt(bal?.available ?? "0")}</span>
                    <span className="pp-walletchip__sep" />
                    <span className="pp-walletchip__addr">{getFormattedAddress(walletAddress)}</span>
                  </span>
                  <div
                    id="balance-breakdown"
                    role="tooltip"
                    className="pointer-events-none absolute right-0 top-full z-50 mt-2 hidden min-w-[220px] group-hover:block"
                  >
                    <div
                      className="rounded-[6px] border p-3"
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
                            ${formatUsdt(bal?.available ?? "0")}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-4">
                          <dt style={{ color: "var(--fg-2)" }}>In orders</dt>
                          <dd className="pp-tabular" style={{ color: "var(--fg-0)" }}>
                            ${formatUsdt(bal?.inOrders ?? "0")}
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
                  className="pp-btn pp-btn--primary pp-btn--sm"
                  onClick={() => setDepositOpen(true)}
                  disabled={!depositAddress}
                >
                  Deposit
                </button>
                <button
                  type="button"
                  className="pp-btn pp-btn--secondary pp-btn--sm hidden sm:inline-flex"
                  onClick={() => setWithdrawOpen(true)}
                >
                  Withdraw
                </button>
                {smartAccount && !sessionReady ? (
                  <button
                    type="button"
                    className={cn(
                      "pp-btn pp-btn--sm hidden sm:inline-flex",
                      sessionRestoreFailed ? "pp-btn--down" : "pp-btn--secondary",
                    )}
                    disabled={isLoading}
                    onClick={() => void reauthorizeSession()}
                  >
                    Re-authorize
                  </button>
                ) : null}
                <button
                  type="button"
                  className="pp-btn pp-btn--ghost pp-btn--sm hidden sm:inline-flex"
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
                  className="pp-btn pp-btn--primary pp-btn--md"
                  disabled={isLoading}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConnectOpen((o) => !o);
                  }}
                >
                  {isLoading ? "Connecting…" : "Connect wallet"}
                </button>
                {connectOpen && (
                  <div
                    className="absolute right-0 top-full z-50 mt-2 min-w-[220px] rounded-[6px] border py-1"
                    style={{
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

            {/* Mobile hamburger */}
            <button
              type="button"
              className="pp-btn pp-btn--ghost pp-btn--sm ml-1 sm:hidden"
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label={mobileMenuOpen ? "Close menu" : "Menu"}
            >
              {mobileMenuOpen ? (
                <X size={18} strokeWidth={1.5} />
              ) : (
                <Menu size={18} strokeWidth={1.5} />
              )}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div
            className="px-4 pb-4 pt-2 sm:hidden"
            style={{ background: "var(--bg-0)", borderTop: "1px solid var(--border-0)" }}
          >
            <nav className="flex flex-col gap-1">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "pp-hdr__navlink",
                    navActive(n.href) && "pp-hdr__navlink--on",
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
                    "pp-hdr__navlink",
                    pathname === "/rebates" && "pp-hdr__navlink--on",
                  )}
                >
                  Rebates
                </Link>
              ) : null}
            </nav>
            {isWalletConnected && walletAddress && (
              <div className="mt-3 flex flex-col gap-2 pt-3" style={{ borderTop: "1px solid var(--border-0)" }}>
                <div className="flex items-center justify-between">
                  <span className="pp-walletchip__addr">{getFormattedAddress(walletAddress)}</span>
                  <span className="pp-walletchip__bal">${formatUsdt(bal?.available ?? "0")}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="pp-btn pp-btn--secondary pp-btn--sm flex-1"
                    onClick={() => {
                      setWithdrawOpen(true);
                      setMobileMenuOpen(false);
                    }}
                  >
                    Withdraw
                  </button>
                  {smartAccount && !sessionReady ? (
                    <button
                      type="button"
                      className={cn(
                        "pp-btn pp-btn--sm flex-1",
                        sessionRestoreFailed ? "pp-btn--down" : "pp-btn--secondary",
                      )}
                      disabled={isLoading}
                      onClick={() => {
                        void reauthorizeSession();
                        setMobileMenuOpen(false);
                      }}
                    >
                      Re-authorize
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="pp-btn pp-btn--ghost pp-btn--sm flex-1"
                    onClick={() => {
                      void disconnectWallet();
                      setMobileMenuOpen(false);
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} depositAddress={depositAddress ?? ""} />
      <WithdrawModal open={withdrawOpen} onClose={() => setWithdrawOpen(false)} />
    </>
  );
}

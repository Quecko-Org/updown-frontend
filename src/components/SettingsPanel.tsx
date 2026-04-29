"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import {
  cookieConsentAtom,
  pushPermissionAtom,
} from "@/store/atoms";
import { setCookieConsent } from "@/lib/cookieConsent";
import { useWalletContext } from "@/context/WalletContext";
import { getFormattedAddress } from "@/utils/walletHelpers";
import {
  TERMS_VERSION,
  getAcceptanceRecord,
  type AcceptanceRecord,
} from "@/lib/termsAcceptance";
import {
  getPushPermission,
  pushIsSupported,
  requestPushPermission,
} from "@/lib/notifications";

/**
 * Client-side preferences surface. Three sections:
 *
 *   1. Wallet — connected EOA + disconnect.
 *   2. Notifications — browser-push permission state, Enable CTA when
 *      "default", inline guidance when blocked. Cookie/analytics consent
 *      toggle (re-uses the shared cookieConsent atom + storage helpers).
 *   3. Legal — current TERMS_VERSION and the acceptance record for the
 *      connected wallet (read from `lib/termsAcceptance`).
 *
 * Plus a placeholder Language row — English-only at v1, exposed so users
 * see "we know this is coming" without making it look broken.
 */
export function SettingsPanel() {
  const { walletAddress, isWalletConnected, disconnectWallet } =
    useWalletContext();
  const [pushPerm, setPushPerm] = useAtom(pushPermissionAtom);
  const [consent, setConsentAtom] = useAtom(cookieConsentAtom);

  // Hydrate push permission once on mount; keeps /settings authoritative
  // even if the user opened it without first opening the bell.
  useEffect(() => {
    setPushPerm(getPushPermission());
  }, [setPushPerm]);

  // Acceptance record is read on render — termsAcceptance is local-only,
  // no need for an atom subscription. Re-derived if the wallet changes.
  const [acceptance, setAcceptance] = useState<AcceptanceRecord | null>(null);
  useEffect(() => {
    if (!walletAddress) {
      setAcceptance(null);
      return;
    }
    setAcceptance(getAcceptanceRecord(walletAddress));
  }, [walletAddress]);

  const acceptedDate = useMemo(() => {
    if (!acceptance || !acceptance.acceptedAt) return "—";
    try {
      return new Date(acceptance.acceptedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "—";
    }
  }, [acceptance]);

  async function handleEnablePush() {
    const result = await requestPushPermission();
    setPushPerm(result);
  }

  function handleConsentChange(next: "accepted" | "rejected") {
    setCookieConsent(next);
    setConsentAtom(next);
  }

  return (
    <div className="space-y-6">
      <Section title="Wallet">
        {isWalletConnected && walletAddress ? (
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="pp-body-strong">Connected</div>
              <div
                className="pp-caption pp-tabular"
                style={{
                  color: "var(--fg-1)",
                  fontFamily: "var(--font-mono)",
                  marginTop: 2,
                }}
              >
                {getFormattedAddress(walletAddress)}
              </div>
            </div>
            <button
              type="button"
              className="pp-btn pp-btn--ghost pp-btn--sm"
              onClick={() => void disconnectWallet()}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <p className="pp-body" style={{ color: "var(--fg-1)" }}>
            No wallet connected. Use “Connect wallet” in the header to sign in.
          </p>
        )}
      </Section>

      <Section title="Notifications">
        <Row
          label="Browser notifications"
          help="Get pinged on the desktop when an order fills or a market resolves."
        >
          {!pushIsSupported() ? (
            <Pill tone="muted">Not supported</Pill>
          ) : pushPerm === "granted" ? (
            <Pill tone="ok">Enabled</Pill>
          ) : pushPerm === "denied" ? (
            <Pill tone="muted">
              Blocked — change in browser settings
            </Pill>
          ) : (
            <button
              type="button"
              className="pp-btn pp-btn--secondary pp-btn--sm"
              onClick={() => void handleEnablePush()}
            >
              Enable
            </button>
          )}
        </Row>

        <Divider />

        <Row
          label="Analytics cookies"
          help="Anonymized usage metrics (PostHog). Wallet addresses are hashed before transmission."
        >
          <ConsentToggle
            value={consent}
            onChange={handleConsentChange}
          />
        </Row>
      </Section>

      <Section title="Legal">
        <Row label="Terms version (current)">
          <span
            className="pp-tabular"
            style={{ color: "var(--fg-0)", fontWeight: 500 }}
          >
            {TERMS_VERSION}
          </span>
        </Row>
        <Divider />
        <Row label="Accepted version">
          <span
            className="pp-tabular"
            style={{ color: "var(--fg-0)", fontWeight: 500 }}
          >
            {acceptance?.version ?? "—"}
          </span>
        </Row>
        <Divider />
        <Row label="Accepted on">
          <span
            className="pp-tabular"
            style={{ color: "var(--fg-0)", fontWeight: 500 }}
          >
            {acceptedDate}
          </span>
        </Row>
        <Divider />
        <Row label="Documents">
          <div className="flex flex-wrap gap-3 justify-end">
            <Link href="/terms" className="pp-link pp-caption">
              Terms
            </Link>
            <Link href="/privacy" className="pp-link pp-caption">
              Privacy
            </Link>
            <Link href="/risk" className="pp-link pp-caption">
              Risk
            </Link>
          </div>
        </Row>
      </Section>

      <Section title="Language">
        <Row
          label="Display language"
          help="More languages on the roadmap — let us know which to prioritize."
        >
          <select
            disabled
            value="en"
            className="pp-tabular"
            style={{
              background: "var(--bg-0)",
              border: "1px solid var(--border-0)",
              borderRadius: 6,
              padding: "4px 8px",
              color: "var(--fg-1)",
            }}
          >
            <option value="en">English</option>
          </select>
        </Row>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-[6px] border p-5"
      style={{ background: "var(--bg-1)", borderColor: "var(--border-0)" }}
    >
      <h2
        className="pp-body-strong"
        style={{ marginBottom: 12, color: "var(--fg-0)" }}
      >
        {title}
      </h2>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function Row({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div
          className="pp-body"
          style={{ color: "var(--fg-0)", fontWeight: 500 }}
        >
          {label}
        </div>
        {help && (
          <div
            className="pp-caption"
            style={{ color: "var(--fg-2)", marginTop: 2, maxWidth: 360 }}
          >
            {help}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: "1px solid var(--border-0)" }} />;
}

function Pill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "ok" | "muted";
}) {
  const color = tone === "ok" ? "var(--up)" : "var(--fg-2)";
  return (
    <span
      className="pp-caption pp-tabular"
      style={{
        color,
        border: `1px solid ${color}`,
        borderRadius: 999,
        padding: "2px 8px",
        opacity: tone === "ok" ? 1 : 0.85,
      }}
    >
      {children}
    </span>
  );
}

function ConsentToggle({
  value,
  onChange,
}: {
  value: "unset" | "accepted" | "rejected";
  onChange: (v: "accepted" | "rejected") => void;
}) {
  return (
    <div className="inline-flex rounded-[6px] border" style={{ borderColor: "var(--border-0)" }}>
      <button
        type="button"
        className="pp-caption px-3 py-1"
        style={{
          background: value === "accepted" ? "var(--up)" : "var(--bg-0)",
          color: value === "accepted" ? "var(--bg-0)" : "var(--fg-1)",
          fontWeight: value === "accepted" ? 600 : 400,
          borderRight: "1px solid var(--border-0)",
        }}
        onClick={() => onChange("accepted")}
      >
        Allow
      </button>
      <button
        type="button"
        className="pp-caption px-3 py-1"
        style={{
          background: value === "rejected" ? "var(--down)" : "var(--bg-0)",
          color: value === "rejected" ? "var(--bg-0)" : "var(--fg-1)",
          fontWeight: value === "rejected" ? 600 : 400,
        }}
        onClick={() => onChange("rejected")}
      >
        Reject
      </button>
    </div>
  );
}

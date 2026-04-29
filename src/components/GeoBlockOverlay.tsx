"use client";

import { useAtomValue } from "jotai";
import Image from "next/image";
import Link from "next/link";
import { geoStateAtom } from "@/store/atoms";

/**
 * Full-viewport scrim shown when the visitor's resolved country is on the
 * restricted list. Returns null in every other state (allowed / unknown /
 * loading) — fail-open, edge-side enforcement is the production line of
 * defense.
 *
 * The overlay does not render `back-to-the-app` controls — by design, the
 * user can't dismiss this. They can read public legal pages (linked) but
 * can't interact with markets, connect a wallet, or trade.
 */
export function GeoBlockOverlay() {
  const geo = useAtomValue(geoStateAtom);
  if (geo.status !== "restricted") return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="geo-block-title"
      className="fixed inset-0 z-[200] flex items-center justify-center px-4"
      style={{
        background: "oklch(8% 0.01 250 / 0.92)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        className="w-full max-w-md rounded-[8px] border p-8 text-center"
        style={{
          background: "var(--bg-1)",
          borderColor: "var(--border-0)",
          boxShadow: "var(--shadow-overlay)",
        }}
      >
        <div className="flex flex-col items-center gap-4">
          <Image
            src="/logo/pulsepairs-mark.svg"
            alt=""
            width={48}
            height={40}
            priority
          />
          <h1
            id="geo-block-title"
            className="pp-h2"
            style={{ marginBottom: 0 }}
          >
            Not available in your region
          </h1>
          <p className="pp-body" style={{ color: "var(--fg-1)" }}>
            PulsePairs is not currently available in your country
            ({geo.country ?? "unknown"}). This restriction is in place to
            comply with applicable laws and regulations.
          </p>
          <p className="pp-caption" style={{ color: "var(--fg-2)", marginTop: 4 }}>
            If you believe you've reached this page in error, contact{" "}
            <a href="mailto:hello@pulsepairs.com" className="pp-link">
              hello@pulsepairs.com
            </a>
            .
          </p>
          <div
            className="mt-4 flex items-center justify-center gap-4 pt-4"
            style={{ borderTop: "1px solid var(--border-0)", width: "100%" }}
          >
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
        </div>
      </div>
    </div>
  );
}

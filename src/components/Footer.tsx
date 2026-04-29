import Image from "next/image";
import Link from "next/link";

/**
 * Site footer. Renders identically across every page (Markets, Portfolio,
 * Fees, Market detail, Resolved markets) via AppShell.
 *
 * Sticky-on-short, natural-on-long: AppShell wraps content in a
 * `min-h-screen flex flex-col` so the main element grows to fill viewport
 * height when content is short, pushing the footer to the bottom. On long
 * pages the footer simply renders below content as normal flow.
 */
const FOOTER_LINKS = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export function Footer() {
  return (
    <footer
      className="mt-12 border-t"
      style={{ borderColor: "var(--border-0)", background: "var(--bg-1)" }}
    >
      <div className="mx-auto flex w-full max-w-[1280px] flex-col items-center justify-between gap-3 px-4 py-5 sm:flex-row sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <Image
            src="/logo/pulsepairs-wordmark-dark.svg"
            alt="PulsePairs"
            width={120}
            height={22}
            className="h-5 w-auto"
          />
          <span className="pp-caption" style={{ color: "var(--fg-2)" }}>
            © 2026 PulsePairs. All rights reserved.
          </span>
        </div>
        <nav className="flex items-center gap-4" aria-label="Footer">
          {FOOTER_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="pp-caption pp-hdr__navlink"
              style={{ color: "var(--fg-2)" }}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

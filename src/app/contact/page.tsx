import Link from "next/link";

export const metadata = { title: "Contact | PulsePairs" };

export default function ContactPage() {
  return (
    <div className="space-y-4" style={{ maxWidth: 640 }}>
      <h1 className="pp-h1">Contact</h1>
      <p className="pp-body" style={{ color: "var(--fg-1)" }}>
        Questions, bug reports, partnership requests, or designated-market-maker
        applications — reach the team directly:
      </p>
      <div
        className="rounded-[6px] border p-4"
        style={{ background: "var(--bg-1)", borderColor: "var(--border-0)" }}
      >
        <p className="pp-body-strong">Email</p>
        <p className="pp-body" style={{ marginTop: 4 }}>
          <a
            href="mailto:hello@pulsepairs.com"
            className="pp-link"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            hello@pulsepairs.com
          </a>
        </p>
      </div>
      <p className="pp-caption" style={{ color: "var(--fg-2)" }}>
        Social channels (X, Discord) will be linked here once they're live.
        For self-serve answers, see the{" "}
        <Link href="/faq" className="pp-link">
          FAQ
        </Link>{" "}
        or{" "}
        <Link href="/how-it-works" className="pp-link">
          How it works
        </Link>
        .
      </p>
    </div>
  );
}
